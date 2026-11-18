package com.indrhi.emergencias.notifications

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import com.indrhi.emergencias.R

class EmergencySirenPlayer(context: Context) {

    private val appContext: Context = context.applicationContext
    private val lock = Any()
    private var player: MediaPlayer? = null
    private var vibrator: Vibrator? = null
    private var savedVolume: Int = -1

    fun start(looping: Boolean = true) {
        synchronized(lock) {
            if (player != null) return
            raiseAlarmVolume()
            startVibration()
            try {
                val sirenUri = Uri.parse("android.resource://${appContext.packageName}/${R.raw.sirena_emergencia}")
                player = MediaPlayer().apply {
                    setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ALARM)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build()
                    )
                    try {
                        setDataSource(appContext, sirenUri)
                    } catch (_: Throwable) {
                        val fallback = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                        setDataSource(appContext, fallback)
                    }
                    isLooping = looping
                    prepare()
                    start()
                }
            } catch (t: Throwable) {
                Log.w(TAG, "No se pudo reproducir la sirena", t)
                releasePlayer()
                stopVibration()
                restoreAlarmVolume()
            }
        }
    }

    fun stop() {
        synchronized(lock) {
            releasePlayer()
            stopVibration()
            restoreAlarmVolume()
        }
    }

    fun isPlaying(): Boolean = synchronized(lock) { player?.isPlaying == true }

    private fun releasePlayer() {
        player?.let { mp ->
            runCatching {
                if (mp.isPlaying) mp.stop()
                mp.release()
            }
        }
        player = null
    }

    private fun startVibration() {
        runCatching {
            vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                appContext.getSystemService(VibratorManager::class.java)?.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                appContext.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            }
            val pattern = longArrayOf(0, 800, 200, 800, 200, 1000)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator?.vibrate(VibrationEffect.createWaveform(pattern, 0))
            } else {
                @Suppress("DEPRECATION")
                vibrator?.vibrate(pattern, 0)
            }
        }
    }

    private fun stopVibration() {
        runCatching { vibrator?.cancel() }
        vibrator = null
    }

    private fun raiseAlarmVolume() {
        if (savedVolume >= 0) return
        val am = appContext.getSystemService(AudioManager::class.java) ?: return
        try {
            savedVolume = am.getStreamVolume(AudioManager.STREAM_ALARM)
            val max = am.getStreamMaxVolume(AudioManager.STREAM_ALARM)
            if (savedVolume < max) {
                am.setStreamVolume(AudioManager.STREAM_ALARM, max, 0)
            }
        } catch (t: Throwable) {
            Log.w(TAG, "No se pudo subir STREAM_ALARM", t)
            savedVolume = -1
        }
    }

    private fun restoreAlarmVolume() {
        if (savedVolume < 0) return
        runCatching {
            appContext.getSystemService(AudioManager::class.java)
                ?.setStreamVolume(AudioManager.STREAM_ALARM, savedVolume, 0)
        }
        savedVolume = -1
    }

    companion object {
        private const val TAG = "EmergencySiren"
    }
}
