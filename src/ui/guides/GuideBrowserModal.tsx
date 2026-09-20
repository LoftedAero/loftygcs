import { LaButton, LaModal } from '../components/La'
import { productProfiles, classGuidesFor, profileById } from '../../profiles'
import { useGuideStore } from '../../stores/guide-store'
import { useVehicleStore } from '../../stores/vehicle-store'

// The one place tailored configuration surfaces. Product aircraft are
// listed for explicit selection; generic class guides appear only for the
// connected vehicle's type. Nothing here is preselected for a user who
// hasn't asked for it.
export default function GuideBrowserModal({ onClose }: { onClose: () => void }) {
  const vehicleType = useVehicleStore((s) => s.vehicleType)
  const present = useVehicleStore((s) => s.present)
  const selectedProfileId = useGuideStore((s) => s.selectedProfileId)
  const startGuide = useGuideStore((s) => s.startGuide)
  const selectProfile = useGuideStore((s) => s.selectProfile)
  const selected = selectedProfileId ? profileById(selectedProfileId) : null

  const classGuides = present ? classGuidesFor(vehicleType) : []

  const start = (profileId: string, guideId: string) => {
    startGuide(profileId, guideId)
    onClose()
  }

  return (
    <LaModal
      open
      title="Guided setups"
      actions={
        <>
          {/* Always drawn, disabled when there is nothing to clear: as a
              paragraph that appeared only once an aircraft was chosen, it
              grew the dialog at the moment of choosing. */}
          <LaButton variant="ghost" disabled={!selected} onClick={() => selectProfile(null)}>
            Clear aircraft
          </LaButton>
          <LaButton variant="ghost" onClick={onClose}>
            Close
          </LaButton>
        </>
      }
    >
      {classGuides.length > 0 && (
        <section className="guide-browser__section">
          <h3 className="guide-browser__heading">For this vehicle</h3>
          {classGuides.map(({ profile, guide }) => (
            <div className="guide-browser__row" key={guide.id}>
              <div className="la-grow">
                <strong>{guide.title}</strong>
                <p className="guide-browser__summary">{guide.summary}</p>
              </div>
              <LaButton variant="secondary" onClick={() => start(profile.id, guide.id)}>
                Start
              </LaButton>
            </div>
          ))}
        </section>
      )}

      <section className="guide-browser__section">
        <h3 className="guide-browser__heading">Product aircraft</h3>
        {productProfiles().map((p) => (
          <div key={p.id}>
            <div className="guide-browser__row">
              <div className="la-grow">
                <strong>{p.name}</strong>
                {p.maker && <span className="la-muted"> · {p.maker}</span>}
                <p className="guide-browser__summary">{p.description}</p>
              </div>
            </div>
            {p.guides.map((guide) => (
              <div className="guide-browser__row guide-browser__row--guide" key={guide.id}>
                <div className="la-grow">
                  {guide.title}
                  <p className="guide-browser__summary">{guide.summary}</p>
                </div>
                <LaButton variant="secondary" onClick={() => start(p.id, guide.id)}>
                  Start
                </LaButton>
              </div>
            ))}
          </div>
        ))}
      </section>

    </LaModal>
  )
}
