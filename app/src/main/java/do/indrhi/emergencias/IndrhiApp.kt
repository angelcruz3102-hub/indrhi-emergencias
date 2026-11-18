package do.indrhi.emergencias

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build

class IndrhiApp : Application() {

    override fun onCreate() {
        super.onCreate()
        createNotificationChannels()
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(NotificationManager::class.java) ?: return

        val alarmSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
        val alarmAttrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()

        val red = NotificationChannel(
            "alerta_roja",
            "Alerta ROJA (Emergencia)",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Riesgo de vida o evacuación. Rompe No Molestar."
            setBypassDnd(true)
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 800, 300, 800, 300, 800)
            setSound(alarmSound, alarmAttrs)
        }

        val yellow = NotificationChannel(
            "alerta_amarilla",
            "Alerta AMARILLA",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Incidentes localizados y emergencias médicas."
            enableVibration(true)
        }

        val green = NotificationChannel(
            "aviso_verde",
            "Avisos VERDES",
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = "Información operativa, rutas y reuniones."
        }

        nm.createNotificationChannels(listOf(red, yellow, green))
    }
}
