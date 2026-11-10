package expo.modules.apoyarnativo

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Android 14 prohíbe iniciar un servicio de micrófono al encender el teléfono. Si la escucha
 * estaba activa, se publica un aviso discreto para que un toque la reanude.
 */
class ArranqueReceiver : BroadcastReceiver() {
  override fun onReceive(contexto: Context, intencion: Intent) {
    if (intencion.action != Intent.ACTION_BOOT_COMPLETED) return
    val preferencias = contexto.getSharedPreferences(PREFERENCIAS, Context.MODE_PRIVATE)
    if (preferencias.getBoolean(CLAVE_ESCUCHA_ACTIVA, false)) avisarReanudacion(contexto)
  }

  private fun avisarReanudacion(contexto: Context) {
    val apertura = contexto.packageManager.getLaunchIntentForPackage(contexto.packageName) ?: return
    val pendiente = PendingIntent.getActivity(
      contexto,
      0,
      apertura,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      contexto.getSystemService(NotificationManager::class.java).createNotificationChannel(
        NotificationChannel(CANAL, "Sincronización en segundo plano", NotificationManager.IMPORTANCE_LOW),
      )
    }
    val aviso = NotificationCompat.Builder(contexto, CANAL)
      .setSmallIcon(android.R.drawable.stat_notify_sync)
      .setContentTitle("Sincronización pausada")
      .setContentText("Tocá para reanudar la sincronización del servicio.")
      .setContentIntent(pendiente)
      .setAutoCancel(true)
      .build()
    try {
      NotificationManagerCompat.from(contexto).notify(ID_AVISO, aviso)
    } catch (_: SecurityException) {
      // Sin permiso de notificaciones no hay forma de avisar
    }
  }

  companion object {
    private const val PREFERENCIAS = "apoyar_nativo"
    private const val CLAVE_ESCUCHA_ACTIVA = "escucha_activa"
    private const val CANAL = "apoyar_reanudacion"
    private const val ID_AVISO = 4101

    fun marcarEscuchaActiva(contexto: Context, activa: Boolean) {
      contexto.getSharedPreferences(PREFERENCIAS, Context.MODE_PRIVATE)
        .edit().putBoolean(CLAVE_ESCUCHA_ACTIVA, activa).apply()
    }
  }
}
