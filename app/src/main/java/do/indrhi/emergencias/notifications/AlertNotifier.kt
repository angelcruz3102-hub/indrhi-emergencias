// ── JUSTO DESPUÉS DE: private val nm = NotificationManagerCompat.from(context)
@Volatile
private var lastAlertId: String? = null
// ──────────────────────────────────────────────────────────────────────

// ── DENTRO DE deliver(): al inicio, tras los dos early-returns
//    (notificationsAllowed / isInScope), ANTES de "AlertChannels.ensure(context)":
lastAlertId = payload.alertId
// ──────────────────────────────────────────────────────────────────────

// ── MÉTODO NUEVO (colócalo junto a cancel()):
/**
 * Detiene la última alarma publicada (test o real) y cierra su pantalla
 * completa. Idempotente: si no hay alarma activa, no hace nada.
 */
fun stopLastAlarm() {
    val id = lastAlertId ?: return
    AlertAckRegistry.markAcked(id)   // dispara el finish en FullScreenAlertActivity
    cancel(id)                       // cancela la notificación en el sistema
    lastAlertId = null
}
// ──────────────────────────────────────────────────────────────────────
