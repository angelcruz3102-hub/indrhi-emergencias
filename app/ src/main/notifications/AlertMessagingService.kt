package do.indrhi.emergencias.notifications

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import do.indrhi.emergencias.IndrhiApp
import do.indrhi.emergencias.work.BackendSyncWorker

/**
 * Ruta crítica: recibe data-messages de prioridad alta.
 * Presupuesto de ejecución ~20 s → aquí NO se hace red, ni GPS, ni consultas.
 */
class AlertMessagingService : FirebaseMessagingService() {

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        if (data.isEmpty()) return

        val payload = AlertPayload.from(data) ?: run {
            Log.w(TAG, "Data-message descartado: payload de alerta inválido")
            return
        }

        val container = (application as IndrhiApp).container

        // 1) Publicación inmediata (solo memoria + NotificationManager).
        val outcome = container.alertNotifier.deliver(payload)

        // 2) Telemetría de entrega diferida a WorkManager (KPI RF-9.4).
        BackendSyncWorker.delivery(
            context = applicationContext,
            alertId = payload.alertId,
            escalationStep = payload.escalationStep,
            outcome = outcome.name,
        )
    }

    override fun onNewToken(token: String) {
        getSharedPreferences(PREFS_DEVICE, MODE_PRIVATE)
            .edit()
            .putString(KEY_FCM_TOKEN, token)
            .apply()

        BackendSyncWorker.token(applicationContext, token)
    }

    override fun onDeletedMessages() {
        // FCM descartó mensajes: el servidor reenviará el estado vigente.
        Log.w(TAG, "FCM reportó mensajes descartados para este dispositivo")
    }

    companion object {
        private const val TAG = "AlertMessagingService"
        private const val PREFS_DEVICE = "indrhi_device"
        private const val KEY_FCM_TOKEN = "fcm_token"
    }
}
