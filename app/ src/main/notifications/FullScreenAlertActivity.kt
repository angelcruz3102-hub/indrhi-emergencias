package do.indrhi.emergencias.notifications

import android.app.KeyguardManager
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.weight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.lifecycleScope
import do.indrhi.emergencias.IndrhiApp
import do.indrhi.emergencias.R
import do.indrhi.emergencias.work.BackendSyncWorker
import kotlinx.coroutines.launch

/**
 * Pantalla completa de alerta ROJA/AMARILLA.
 * - Se muestra sobre el bloqueo y enciende la pantalla.
 * - Refuerza el audio por STREAM_ALARM (el canal ya trae el tono de alarma).
 * - En ROJO no se puede salir sin acuse.
 * - Degrada con elegancia si Android 14+ niega USE_FULL_SCREEN_INTENT:
 *   la actividad simplemente se abre como heads-up normal.
 */
class FullScreenAlertActivity : ComponentActivity() {

    private var payload: AlertPayload? = null
    private var mediaPlayer: MediaPlayer? = null
    private var previousAlarmVolume: Int = -1

    private val handler = Handler(Looper.getMainLooper())
    private val stopAlarmRunnable = Runnable { stopAlarmAudio(restoreVolume = true) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val incoming = AlertPayload.fromIntent(intent)
        if (incoming == null) {
            finish()
            return
        }
        payload = incoming

        renderOverLockScreen()
        blockBackNavigationOnRed()
        startAlarmAudio(incoming)
        observeExternalAck()

        setContent {
            AlertContent(payload = incoming, onAcknowledge = { acknowledge(incoming) })
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val incoming = AlertPayload.fromIntent(intent) ?: return
        payload = incoming
        startAlarmAudio(incoming)
        setContent {
            AlertContent(payload = incoming, onAcknowledge = { acknowledge(incoming) })
        }
    }

    override fun onDestroy() {
        stopAlarmAudio(restoreVolume = true)
        super.onDestroy()
    }

    // ------------------------------------------------------------- comportamiento

    private fun renderOverLockScreen() {
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
            getSystemService(KeyguardManager::class.java)?.requestDismissKeyguard(this, null)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
            )
        }
    }

    private fun blockBackNavigationOnRed() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (payload?.severity != Severity.ROJO) {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })
    }

    private fun observeExternalAck() {
        lifecycleScope.launch {
            AlertAckRegistry.acked.collect { acked ->
                val current = payload ?: return@collect
                if (acked.contains(current.alertId)) {
                    stopAlarmAudio(restoreVolume = true)
                    finishAndRemoveTaskSafely()
                }
            }
        }
    }

    private fun acknowledge(payload: AlertPayload) {
        AlertAckRegistry.markAcked(payload.alertId)
        stopAlarmAudio(restoreVolume = true)

        val container = (application as IndrhiApp).container
        container.alertNotifier.cancel(payload.alertId)

        // El acuse se reporta con reintentos: si no hay red, WorkManager lo reintenta.
        BackendSyncWorker.ack(applicationContext, payload.alertId, payload.escalationStep)

        finishAndRemoveTaskSafely()
    }

    private fun finishAndRemoveTaskSafely() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) finishAndRemoveTask() else finish()
    }

    // ------------------------------------------------------------------- audio

    private fun startAlarmAudio(payload: AlertPayload) {
        if (payload.severity == Severity.VERDE) return

        val am = getSystemService(AudioManager::class.java)
        if (am != null) {
            try {
                if (previousAlarmVolume < 0) {
                    previousAlarmVolume = am.getStreamVolume(AudioManager.STREAM_ALARM)
                }
                val max = am.getStreamMaxVolume(AudioManager.STREAM_ALARM)
                if (payload.severity == Severity.ROJO &&
                    am.getStreamVolume(AudioManager.STREAM_ALARM) < max
                ) {
                    am.setStreamVolume(AudioManager.STREAM_ALARM, max, 0)
                }
            } catch (t: Throwable) {
                Log.w(TAG, "No fue posible reforzar el volumen de alarma", t)
            }
        }

        // Si el usuario silenció el canal rojo, el tono del canal no suena: lo cubrimos aquí.
        if (payload.severity == Severity.ROJO && !isRedChannelAudible()) {
            playLoopingAlarm()
        }

        handler.removeCallbacks(stopAlarmRunnable)
        handler.postDelayed(stopAlarmRunnable, MAX_ALARM_MS)
    }

    private fun isRedChannelAudible(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true
        val channel = getSystemService(NotificationManager::class.java)
            ?.getNotificationChannel(AlertChannels.RED)
            ?: return true
        return channel.sound != null &&
            channel.importance >= NotificationManager.IMPORTANCE_HIGH
    }

    private fun playLoopingAlarm() {
        if (mediaPlayer != null) return

        val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
            ?: return

        try {
            mediaPlayer = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
                setDataSource(this@FullScreenAlertActivity, uri)
                isLooping = true
                prepare()
                start()
            }
        } catch (t: Throwable) {
            Log.w(TAG, "No fue posible reproducir el tono de alarma en bucle", t)
            mediaPlayer?.let { mp -> runCatching { mp.release() } }
            mediaPlayer = null
        }
    }

    private fun stopAlarmAudio(restoreVolume: Boolean) {
        handler.removeCallbacks(stopAlarmRunnable)

        mediaPlayer?.let { mp ->
            runCatching {
                if (mp.isPlaying) mp.stop()
                mp.release()
            }
        }
        mediaPlayer = null

        if (restoreVolume && previousAlarmVolume >= 0) {
            runCatching {
                getSystemService(AudioManager::class.java)
                    ?.setStreamVolume(AudioManager.STREAM_ALARM, previousAlarmVolume, 0)
            }
            previousAlarmVolume = -1
        }
    }

    companion object {
        private const val TAG = "FullScreenAlert"
        private const val MAX_ALARM_MS = 120_000L

        fun newIntent(context: Context, payload: AlertPayload): Intent =
            Intent(context, FullScreenAlertActivity::class.java).apply {
                addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP
                )
                putExtras(payload.toBundle())
            }
    }
}

// --------------------------------------------------------------------- UI

@Composable
private fun AlertContent(payload: AlertPayload, onAcknowledge: () -> Unit) {
    val background = when (payload.severity) {
        Severity.ROJO -> Color(0xFFB71C1C)
        Severity.AMARILLO -> Color(0xFFF9A825)
        Severity.VERDE -> Color(0xFF2E7D32)
    }
    val contentColor =
        if (payload.severity == Severity.AMARILLO) Color(0xFF141414) else Color.White

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(background)
            .safeDrawingPadding()
            .padding(horizontal = 24.dp, vertical = 20.dp)
    ) {
        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            if (payload.isDrill) {
                Text(
                    text = stringResource(R.string.drill_badge),
                    color = contentColor,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Black,
                    modifier = Modifier
                        .background(Color.White.copy(alpha = 0.25f), RoundedCornerShape(8.dp))
                        .padding(horizontal = 12.dp, vertical = 6.dp)
                )
            }

            Text(
                text = payload.title,
                color = contentColor,
                fontSize = 30.sp,
                lineHeight = 34.sp,
                fontWeight = FontWeight.Black
            )

            payload.buildingCode?.let { code ->
                Text(
                    text = stringResource(R.string.building_format, code),
                    color = contentColor,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.SemiBold
                )
            }

            Text(
                text = payload.message,
                color = contentColor,
                fontSize = 20.sp,
                lineHeight = 26.sp
            )

            if (payload.severity == Severity.ROJO) {
                Text(
                    text = stringResource(R.string.shake_cover_hold),
                    color = contentColor,
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold
                )
            }

            Text(
                text = stringResource(R.string.footer_legal),
                color = contentColor.copy(alpha = 0.75f),
                fontSize = 12.sp
            )
        }

        Spacer(Modifier.height(16.dp))

        Button(
            onClick = onAcknowledge,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 96.dp),
            shape = RoundedCornerShape(16.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = Color.White,
                contentColor = background
            )
        ) {
            Text(
                text = stringResource(
                    if (payload.requiresAck) R.string.action_ack else R.string.action_dismiss
                ),
                fontSize = 22.sp,
                fontWeight = FontWeight.Black,
                textAlign = TextAlign.Center
            )
        }
    }
}
