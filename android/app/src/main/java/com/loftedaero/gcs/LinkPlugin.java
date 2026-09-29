package com.loftedaero.gcs;

import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketAddress;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * The byte links the desktop app gets from Electron's main process
 * (electron/ipc-links.ts), for the Android app: TCP, UDP, and a UART such as
 * the AX12's internal ELRS port. The web side sees the same open / write /
 * close / data / close surface either way (src/transport/native-link.ts).
 */
@CapacitorPlugin(name = "Link")
public class LinkPlugin extends Plugin {

    private interface Sender {
        void send(byte[] data) throws Exception;
    }

    private static final class Link {
        final ExecutorService writer = Executors.newSingleThreadExecutor();
        volatile boolean closed;
        Closeable resource;
        Sender sender;
    }

    private final Map<Integer, Link> links = new ConcurrentHashMap<>();
    private final AtomicInteger nextId = new AtomicInteger(1);

    @PluginMethod
    public void open(PluginCall call) {
        String kind = call.getString("kind", "");
        int id = nextId.getAndIncrement();
        Link link = new Link();
        // Connecting can block for seconds; the plugin thread serves every
        // other call meanwhile.
        new Thread(() -> {
            try {
                switch (kind) {
                    case "tcp":
                        openTcp(call, id, link);
                        break;
                    case "udp":
                        openUdp(call, id, link);
                        break;
                    case "uart":
                        openUart(call, id, link);
                        break;
                    default:
                        throw new IllegalArgumentException("unknown link kind " + kind);
                }
                links.put(id, link);
                JSObject ret = new JSObject();
                ret.put("id", id);
                call.resolve(ret);
            } catch (Exception e) {
                shut(link);
                call.reject(e.getMessage() != null ? e.getMessage() : e.toString());
            }
        }, "link-open-" + id).start();
    }

    @PluginMethod(returnType = PluginMethod.RETURN_NONE)
    public void write(PluginCall call) {
        Link link = links.get(call.getInt("id", -1));
        String data = call.getString("data");
        if (link == null || data == null || link.closed) return;
        byte[] bytes = Base64.decode(data, Base64.NO_WRAP);
        link.writer.execute(() -> {
            try {
                link.sender.send(bytes);
            } catch (Exception e) {
                // A failed write means the link is gone; the reader reports it.
            }
        });
    }

    @PluginMethod
    public void close(PluginCall call) {
        Link link = links.remove(call.getInt("id", -1));
        if (link != null) shut(link);
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        for (Link link : links.values()) shut(link);
        links.clear();
    }

    private void openTcp(PluginCall call, int id, Link link) throws Exception {
        String host = call.getString("host", "127.0.0.1");
        int port = call.getInt("port", 0);
        Socket socket = new Socket();
        link.resource = socket;
        socket.connect(new InetSocketAddress(host, port), 5000);
        socket.setTcpNoDelay(true);
        OutputStream out = socket.getOutputStream();
        link.sender = out::write;
        startReader(id, link, socket.getInputStream());
    }

    // Bind locally and, until a remote is known, learn it from the first
    // packet, as the desktop app does.
    private void openUdp(PluginCall call, int id, Link link) throws Exception {
        String host = call.getString("host");
        int port = call.getInt("port", 0);
        int localPort = call.getInt("localPort", 0);
        DatagramSocket socket = new DatagramSocket(null);
        link.resource = socket;
        socket.bind(new InetSocketAddress(localPort));
        final SocketAddress[] remote = {host != null ? new InetSocketAddress(host, port) : null};
        link.sender = data -> {
            if (remote[0] != null) socket.send(new DatagramPacket(data, data.length, remote[0]));
        };
        new Thread(() -> {
            byte[] buf = new byte[65535];
            DatagramPacket packet = new DatagramPacket(buf, buf.length);
            try {
                while (!link.closed) {
                    socket.receive(packet);
                    if (remote[0] == null) remote[0] = packet.getSocketAddress();
                    emitData(id, buf, packet.getLength());
                }
            } catch (Exception e) {
                ended(id, link, e);
            }
        }, "link-udp-" + id).start();
    }

    // A UART is a device node: set the line with the system's stty, then read
    // and write it as a file. "min 0 time 1" makes a read return after 100 ms
    // without data, so closing never waits on a read that nothing will end.
    // Android 9's toybox stty scrambles the input flags when given "-echo"
    // (and some other local and control flags), turning on XON/XOFF, case
    // folding and parity marking that rewrite, swallow and double binary
    // bytes. "raw" rewrites the input flags cleanly but leaves echo on, so
    // "-echo" must come before it.
    private void openUart(PluginCall call, int id, Link link) throws Exception {
        String path = call.getString("path", "/dev/ttyS1");
        int baud = call.getInt("baudRate", 460800);
        Process stty = new ProcessBuilder(
                "stty", "-F", path, "-echo", String.valueOf(baud), "raw", "min", "0", "time", "1")
                .redirectErrorStream(true)
                .start();
        String output = readAll(stty.getInputStream());
        if (stty.waitFor() != 0) {
            throw new Exception("Cannot configure " + path + ": " + output.trim());
        }
        FileInputStream in = new FileInputStream(path);
        FileOutputStream out = new FileOutputStream(path);
        link.resource = () -> {
            in.close();
            out.close();
        };
        link.sender = data -> {
            out.write(data);
            out.flush();
        };
        new Thread(() -> {
            byte[] buf = new byte[4096];
            try {
                while (!link.closed) {
                    int n = in.read(buf);
                    if (n > 0) emitData(id, buf, n);
                }
            } catch (Exception e) {
                ended(id, link, e);
            }
        }, "link-uart-" + id).start();
    }

    private void startReader(int id, Link link, InputStream in) {
        new Thread(() -> {
            byte[] buf = new byte[4096];
            try {
                int n;
                while (!link.closed && (n = in.read(buf)) >= 0) {
                    if (n > 0) emitData(id, buf, n);
                }
                ended(id, link, null);
            } catch (Exception e) {
                ended(id, link, e);
            }
        }, "link-read-" + id).start();
    }

    private void emitData(int id, byte[] buf, int length) {
        JSObject ret = new JSObject();
        ret.put("id", id);
        ret.put("data", Base64.encodeToString(buf, 0, length, Base64.NO_WRAP));
        notifyListeners("data", ret);
    }

    // The link ended on its own. Not reported after close(), which the web
    // side asked for.
    private void ended(int id, Link link, Exception e) {
        if (link.closed) return;
        links.remove(id);
        shut(link);
        JSObject ret = new JSObject();
        ret.put("id", id);
        if (e != null && e.getMessage() != null) ret.put("error", e.getMessage());
        notifyListeners("close", ret);
    }

    private static void shut(Link link) {
        link.closed = true;
        link.writer.shutdownNow();
        try {
            if (link.resource != null) link.resource.close();
        } catch (Exception ignored) {
            // Already closed.
        }
    }

    private static String readAll(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[1024];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toString("UTF-8");
    }
}
