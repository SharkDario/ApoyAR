package expo.modules.apoyarnativo

import android.app.Activity
import android.content.Context
import android.media.AudioManager
import android.media.VolumeProvider
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.SystemClock
import android.view.KeyEvent
import android.view.Window

/**
 * Activación del Modo Resguardo con botones físicos (RF-2.4):
 * apretar 3 veces Volumen abajo en menos de 2 segundos.
 *
 * Las pulsaciones llegan por dos caminos:
 * 1. Con la app a la vista (incluida la calculadora señuelo): se leen en el
 *    Window.Callback de la actividad, antes que el sistema.
 * 2. Con la Escucha en vivo activa, en segundo plano o con la pantalla apagada:
 *    una sesión de medios con volumen remoto recibe las teclas de volumen, que
 *    Android le entrega a la sesión activa aunque la pantalla esté apagada.
 *    La sesión no reproduce sonido y reenvía cada pulsación al volumen real.
 *
 * Si una pulsación llega por los dos caminos a la vez, se cuenta una sola vez.
 */
object BotonesFisicos {
  private const val PULSACIONES = 3
  private const val VENTANA_MS = 2000L
  /** Ignora repeticiones al mantener apretado y la misma pulsación vista por los dos caminos. */
  private const val SEPARACION_MINIMA_MS = 120L

  @Volatile
  var habilitado = false
    private set

  @Volatile
  private var escuchaActiva = false

  var alDetectar: (() -> Unit)? = null

  private val marcas = ArrayDeque<Long>()
  private var sesion: MediaSession? = null

  fun configurar(contexto: Context, actividad: Activity?, activo: Boolean) {
    habilitado = activo
    if (!activo) reiniciarConteo()
    instalar(actividad)
    actualizarSesion(contexto)
  }

  fun marcarEscucha(contexto: Context, activa: Boolean) {
    escuchaActiva = activa
    actualizarSesion(contexto)
  }

  /** Camino 1: teclas de la ventana de la app. No las consume: el volumen baja igual. */
  fun instalar(actividad: Activity?) {
    val ventana = actividad?.window ?: return
    actividad.runOnUiThread {
      val actual = ventana.callback ?: return@runOnUiThread
      if (actual !is Envoltorio) {
        ventana.callback = Envoltorio(actual)
      }
    }
  }

  @Synchronized
  private fun registrarBajada() {
    if (!habilitado) return
    val ahora = SystemClock.uptimeMillis()
    val ultima = marcas.lastOrNull()
    if (ultima != null && ahora - ultima < SEPARACION_MINIMA_MS) return
    marcas.addLast(ahora)
    while (marcas.isNotEmpty() && ahora - marcas.first() > VENTANA_MS) marcas.removeFirst()
    if (marcas.size >= PULSACIONES) {
      marcas.clear()
      alDetectar?.invoke()
    }
  }

  @Synchronized
  private fun reiniciarConteo() {
    marcas.clear()
  }

  /** Camino 2: sesión de medios mientras la Escucha en vivo está activa. */
  private fun actualizarSesion(contexto: Context) {
    val app = contexto.applicationContext
    android.os.Handler(app.mainLooper).post {
      if (habilitado && escuchaActiva) abrirSesion(app) else cerrarSesion()
    }
  }

  private fun abrirSesion(contexto: Context) {
    if (sesion != null) return
    val audio = contexto.getSystemService(AudioManager::class.java)
    val proveedor = object : VolumeProvider(VOLUME_CONTROL_RELATIVE, 100, 50) {
      override fun onAdjustVolume(direccion: Int) {
        if (direccion < 0) registrarBajada()
        // La sesión toma las teclas de volumen: se reenvían para que el volumen siga funcionando
        if (direccion != 0) {
          audio?.adjustStreamVolume(
            AudioManager.STREAM_MUSIC,
            if (direccion > 0) AudioManager.ADJUST_RAISE else AudioManager.ADJUST_LOWER,
            0,
          )
        }
      }
    }
    sesion = MediaSession(contexto, "Sincronizacion").apply {
      setPlaybackToRemote(proveedor)
      // Android solo entrega el volumen a una sesión que figura en reproducción
      setPlaybackState(
        PlaybackState.Builder().setState(PlaybackState.STATE_PLAYING, 0L, 1f).build(),
      )
      isActive = true
    }
  }

  private fun cerrarSesion() {
    sesion?.let {
      it.isActive = false
      it.release()
    }
    sesion = null
  }

  private class Envoltorio(private val base: Window.Callback) : Window.Callback by base {
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
      if (event.keyCode == KeyEvent.KEYCODE_VOLUME_DOWN &&
        event.action == KeyEvent.ACTION_DOWN &&
        event.repeatCount == 0
      ) {
        registrarBajada()
      }
      return base.dispatchKeyEvent(event)
    }
  }
}
