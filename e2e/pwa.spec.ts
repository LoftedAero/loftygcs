import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { encodeFrame } from '../src/protocol/frames'

const version = JSON.parse(readFileSync('package.json', 'utf8')).version as string

test('root installation preserves a nested app and saved maps offline', async ({
  page,
  context,
}) => {
  const tiles = /^https:\/\/server\.arcgisonline\.com\//
  await context.route(tiles, (route) =>
    route.fulfill({
      contentType: 'image/png',
      path: 'public/icons/apple-touch-icon.png',
    }),
  )
  await page.goto('/nested/gcs/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await expect
    .poll(() =>
      page
        .locator('.leaflet-tile')
        .evaluateAll(
          (images) =>
            images.length > 0 &&
            images.every(
              (image) =>
                image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
            ),
        ),
    )
    .toBe(true)
  // IndexedDB writes finish asynchronously after displayed tiles load.
  await page.waitForFunction(
    () =>
      new Promise<boolean>((resolve) => {
        const request = indexedDB.open('loftgcs-tiles')
        request.onsuccess = () => {
          const db = request.result
          const transaction = db.transaction('tiles', 'readonly')
          const count = transaction.objectStore('tiles').count()
          transaction.oncomplete = () => {
            db.close()
            resolve(count.result > 0)
          }
        }
      }),
  )
  const root = await context.newPage()
  await root.goto('/')
  await root.evaluate(() => navigator.serviceWorker.ready)
  await root.reload()
  await context.unroute(tiles)
  await context.setOffline(true)
  for (const app of [page, root]) {
    await app.reload()
    await expect(app.getByRole('button', { name: 'Connect', exact: true })).toBeVisible()
    await expect
      .poll(() =>
        app
          .locator('.leaflet-tile')
          .evaluateAll(
            (images) =>
              images.length > 0 &&
              images.every(
                (image) =>
                  image instanceof HTMLImageElement &&
                  image.complete &&
                  image.naturalWidth > 0 &&
                  image.src.startsWith('blob:'),
              ),
          ),
      )
      .toBe(true)
  }
})

test.beforeEach(async ({ context, request }) => {
  await request.post('/__test/release')
  await context.addInitScript((v) => {
    localStorage.setItem('loftgcs.previewAcknowledged', v)
  }, version)
})

test('failed first installation can be retried without reloading', async ({ page, request }) => {
  await request.post('/__test/release?fail')
  await page.goto('/nested/gcs/')
  await page.getByRole('button', { name: 'Preferences', exact: true }).click()
  await expect(page.getByText('Offline app unavailable', { exact: true })).toBeVisible()
  await request.post('/__test/release')
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByText('App ready offline', { exact: true })).toBeVisible()
})

test('cached app starts its protocol worker over a WebSocket', async ({ page, context }) => {
  await page.goto('/nested/gcs/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  const websocketUrl = 'wss://telemetry.example/mavlink'
  const heartbeat = Buffer.from(
    encodeFrame(
      'HEARTBEAT',
      {
        type: 2,
        autopilot: 3,
        base_mode: 0,
        custom_mode: 0,
        system_status: 3,
        mavlink_version: 3,
      },
      0,
      1,
      1,
    ),
  )
  let messages = 0
  await page.routeWebSocket(websocketUrl, (socket) => {
    socket.onMessage((bytes) => {
      if (typeof bytes !== 'string' && bytes[0] === 0xfd) {
        messages++
        if (messages === 1) socket.send(heartbeat)
      }
    })
  })
  await context.setOffline(true)
  await page.reload()
  await page.getByRole('combobox').first().selectOption('ws')
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
  await page.getByLabel('URL', { exact: true }).fill(websocketUrl)
  await page
    .locator('.la-modal')
    .filter({ hasText: 'Connect to WebSocket bridge' })
    .getByRole('button', { name: 'Connect', exact: true })
    .click()
  await expect.poll(() => messages).toBeGreaterThan(1)
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeEnabled()
})

for (const base of ['/', '/nested/gcs/']) {
  test(`cold offline launch from ${base}`, async ({ page, context }) => {
    await page.goto(base)
    await page.evaluate(() => navigator.serviceWorker.ready)
    await page.reload()
    await page.waitForFunction(() => !!navigator.serviceWorker.controller)
    const resources = await page.evaluate(async () => {
      const keys = await caches.keys()
      const cache = await caches.open(keys.find((key) => key.includes('precache'))!)
      return (await cache.keys()).map((r) => new URL(r.url).pathname)
    })
    // The protocol worker is inlined into the main JS for Electron file:// support.
    expect(resources.some((url) => /\/assets\/index-.*\.js$/.test(url))).toBe(true)
    expect(resources.some((url) => url.includes('/cesium/Workers/'))).toBe(true)
    expect(resources.some((url) => url.endsWith('.gltf'))).toBe(true)
    expect(resources).toContain(`${base}icons/apple-touch-icon.png`)
    await context.setOffline(true)
    await page.close()
    const offline = await context.newPage()
    await offline.goto(base)
    await expect(offline.getByRole('button', { name: 'Connect', exact: true })).toBeVisible()
    await offline.getByRole('button', { name: 'Preferences', exact: true }).click()
    await expect(offline.getByText('App ready offline', { exact: true })).toBeVisible()
    // Cache reads must cover runtime assets too, without turning unknown
    // requests (including device credentials) into cached HTML responses.
    const results = await offline.evaluate(async (urls) => {
      const checks = await Promise.all(urls.map(async (url) => (await fetch(url)).ok))
      let unknownFailed = false
      try {
        await fetch('./uncached-resource')
      } catch {
        unknownFailed = true
      }
      return { checks, unknownFailed }
    }, resources)
    expect(results.checks.every(Boolean)).toBe(true)
    expect(results.unknownFailed).toBe(true)
  })
}

test('updates wait for every app window, failed updates preserve the installed app', async ({
  page,
  context,
  request,
}) => {
  await page.goto('/nested/gcs/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  const second = await context.newPage()
  await second.goto('/nested/gcs/')
  const idle = await context.newPage()
  await idle.goto('/__test/idle')
  await request.post('/__test/release')
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update())
  await page.waitForFunction(
    async () => !!(await navigator.serviceWorker.getRegistration())?.waiting,
  )
  await page.getByRole('button', { name: 'Preferences', exact: true }).click()
  await expect(page.getByText('Update saved. Close all app windows to apply.')).toBeVisible()
  await page.reload()
  expect(
    await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting),
  ).toBe(true)
  await page.close()
  expect(
    await second.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting),
  ).toBe(true)
  await second.close()
  await idle.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.getRegistration('/nested/gcs/')
    return reg?.active?.state === 'activated' && !reg.waiting
  })
  const reopened = await context.newPage()
  await reopened.goto('/nested/gcs/')
  await request.post('/__test/release?fail')
  await reopened.evaluate(async () => {
    const reg = (await navigator.serviceWorker.getRegistration())!
    await new Promise<void>((resolve) => {
      reg.addEventListener(
        'updatefound',
        () => {
          const worker = reg.installing!
          worker.addEventListener('statechange', () => {
            if (worker.state === 'redundant') resolve()
          })
        },
        { once: true },
      )
      void reg.update()
    })
  })
  await context.setOffline(true)
  await reopened.reload()
  await expect(reopened.getByRole('button', { name: 'Connect', exact: true })).toBeVisible()
})
