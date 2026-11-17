package do.indrhi.emergencias.notifications

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import do.indrhi.emergencias.R

/**
 * Canales de notificación creados UNA sola vez (idempotente).
 * Android no permite subir la importancia de un canal ya creado: por eso ROJO
 * nace con IMPORTANCE_HIGH y jamás se recrea con parámetros distintos.
 */
object AlertChannels {

    const val RED = "alerta_roja"
    const val YELLOW = "alerta_amarilla"
    const val GREEN = "aviso_verde"

    const val GROUP_KEY = "do.indrhi.emergencias.ALERTAS"

    /** Vibración continua: espera 0 ms, vibra 1 s, pausa 0.5 s y repite desde el índice 0. */
    private val RED_VIBRATION = longArrayOf(0L, 1_000L, 500L)
    private val YELLOW_VIBRATION = longArrayOf(0L, 400L, 250L, 400L)

    fun ensure(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = context.getSystemService(NotificationManager::class.java) ?: return

        val alarmUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)

        val alarmAttributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()

        val red = NotificationChannel(
            RED,
            context.getString(R.string.channel_red_name),
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = context.getString(R.string.channel_red_desc)
            setSound(alarmUri, alarmAttributes)
            enableVibration(true)
            vibrationPattern = RED_VIBRATION
            enableLights(true)
            lightColor = 0xFFFF1744.toInt()
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            setShowBadge(true)
            // Rompe No Molestar. Requiere ACCESS_NOTIFICATION_POLICY concedido;
            // si no lo está, Android simplemente lo ignora (no lanza excepción).
            setBypassDnd(true)
        }

        val yellow = NotificationChannel(
            YELLOW,
            context.getString(R.string.channel_yellow_name),
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = context.getString(R.string.channel_yellow_desc)
            setSound(
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build(),
            )
            enableVibration(true)
            vibrationPattern = YELLOW_VIBRATION
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }

        val green = NotificationChannel(
            GREEN,
            context.getString(R.string.channel_green_name),
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            description = context.getString(R.string.channel_green_desc)
            setShowBadge(true)
        }

        nm.createNotificationChannels(listOf(red, yellow, green))
    }

    /** Indicador de salud: acceso a política de No Molestar (RF-9.4). */
    fun canBypassDnd(context: Context): Boolean =
        context.getSystemService(NotificationManager::class.java)
            ?.isNotificationPolicyAccessGranted == true
}
