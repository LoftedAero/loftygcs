package com.loftedaero.gcs;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Text to speech for the voice callouts (src/services/voice/speech.ts).
 * Android's WebView has no speechSynthesis, so the app speaks through the
 * system engine instead. Each speak call resolves when the phrase has
 * finished, so the web side's queue can pace itself; nothing rejects, since a
 * phrase that cannot be spoken is simply skipped.
 */
@CapacitorPlugin(name = "Speech")
public class SpeechPlugin extends Plugin {

    private TextToSpeech tts;
    /** Null until the engine has bound; true or false after. */
    private volatile Boolean ready = null;
    /** Calls made while the engine was still binding. */
    private final List<PluginCall> early = new ArrayList<>();
    private final Map<String, PluginCall> speaking = new ConcurrentHashMap<>();
    private final AtomicInteger nextId = new AtomicInteger(1);
    private AudioManager audio;
    private AudioFocusRequest focus;

    // Spoken as navigation guidance: other audio (video) ducks under it, and
    // it follows the volume a pilot set for such prompts.
    private static final AudioAttributes ATTRIBUTES = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build();

    @Override
    public void load() {
        audio = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        // Binding to the engine is asynchronous; QGroundControl 5.1 went silent
        // on Android by speaking before it finished.
        tts = new TextToSpeech(getContext(), status -> {
            boolean ok = status == TextToSpeech.SUCCESS;
            if (ok) {
                int lang = tts.setLanguage(Locale.US);
                if (lang < TextToSpeech.LANG_AVAILABLE) tts.setLanguage(Locale.getDefault());
                tts.setAudioAttributes(ATTRIBUTES);
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override
                    public void onStart(String id) {}

                    @Override
                    public void onDone(String id) {
                        finish(id);
                    }

                    @Override
                    public void onError(String id) {
                        finish(id);
                    }

                    @Override
                    public void onStop(String id, boolean interrupted) {
                        finish(id);
                    }
                });
            }
            List<PluginCall> waiting;
            synchronized (early) {
                ready = ok;
                waiting = new ArrayList<>(early);
                early.clear();
            }
            for (PluginCall call : waiting) {
                if (ok) say(call);
                else call.resolve();
            }
        });
    }

    @PluginMethod
    public void speak(PluginCall call) {
        synchronized (early) {
            if (ready == null) {
                early.add(call);
                return;
            }
        }
        if (Boolean.TRUE.equals(ready)) say(call);
        else call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (tts != null) tts.stop();
        for (String id : speaking.keySet()) finish(id);
        call.resolve();
    }

    private void say(PluginCall call) {
        String text = call.getString("text", "");
        if (text == null || text.isEmpty()) {
            call.resolve();
            return;
        }
        String id = "u" + nextId.getAndIncrement();
        speaking.put(id, call);
        takeFocus();
        Bundle params = new Bundle();
        // The web side queues; anything still speaking was meant to be cut off.
        int result = tts.speak(text, TextToSpeech.QUEUE_FLUSH, params, id);
        if (result != TextToSpeech.SUCCESS) finish(id);
    }

    private void finish(String id) {
        PluginCall call = speaking.remove(id);
        if (call != null) call.resolve();
        if (speaking.isEmpty()) dropFocus();
    }

    private void takeFocus() {
        if (audio == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (focus == null) {
                focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                        .setAudioAttributes(ATTRIBUTES)
                        .build();
            }
            audio.requestAudioFocus(focus);
        } else {
            audio.requestAudioFocus(null, AudioManager.STREAM_MUSIC,
                    AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
        }
    }

    private void dropFocus() {
        if (audio == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (focus != null) audio.abandonAudioFocusRequest(focus);
        } else {
            audio.abandonAudioFocus(null);
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (tts != null) tts.shutdown();
        tts = null;
    }
}
