package do.indrhi.emergencias.notifications

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import do.indrhi.emergencias.IndrhiApp
import do.indrhi.emergencias.work.BackendSyncWorker

/**
 * Acuse de recibo desde la notificación (sin abrir la app).
 * El envío al backend va por WorkManager: sobrevive a la muerte del proceso.
 */
class AlertActionReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_ACK) return

        val payload = AlertPayload.fromIntent(intent) ?: return
        AlertAckRegistry.markAcked(payload.alertId)

        val app = context.applicationContext as IndrhiApp
        app.container.alertNotifier.cancel(payload.alertId)
        BackendSyncWorker.ack(context.applicationContext, payload.alertId, payload.escalationStep)
    }

    companion object {
        const val ACTION_ACK = "do.indrhi.emergencias.action.ACK"

        fun ackIntent(context: Context, payload: AlertPayload): Intent =
            Intent(context, AlertActionReceiver::class.java).apply {
                action = ACTION_ACK
                putExtras(payload.toBundle())
            }
    }
}
