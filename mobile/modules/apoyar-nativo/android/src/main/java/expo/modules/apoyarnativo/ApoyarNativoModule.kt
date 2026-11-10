package expo.modules.apoyarnativo

import android.content.Context
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Puente entre React Native y las funciones que deben correr fuera de JavaScript. */
class ApoyarNativoModule : Module() {
  private val contexto: Context
    get() = requireNotNull(appContext.reactContext) { "Contexto de Android no disponible." }

  override fun definition() = ModuleDefinition {
    Name("ApoyarNativo")

    // ── Activación con botones físicos: 3 veces Volumen abajo en 2 s (RF-2.4) ──
    Events("onPulsacionesVolumen")

    OnCreate {
      BotonesFisicos.alDetectar = {
        sendEvent("onPulsacionesVolumen", mapOf("momento" to System.currentTimeMillis()))
      }
      BotonesFisicos.instalar(appContext.currentActivity)
    }

    OnActivityEntersForeground {
      BotonesFisicos.instalar(appContext.currentActivity)
    }

    OnDestroy {
      BotonesFisicos.alDetectar = null
    }

    Function("configurarBotonesFisicos") { habilitado: Boolean ->
      BotonesFisicos.configurar(contexto, appContext.currentActivity, habilitado)
    }

    // ── Inferencia acústica local (RF-2.2) ───────────────────────────────────
    AsyncFunction("prepararModelos") Coroutine { ->
      withContext(Dispatchers.IO) {
        InferenciaAcustica.preparar(contexto)
        true
      }
    }

    AsyncFunction("analizarVentana") Coroutine { pcmBase64: String ->
      withContext(Dispatchers.Default) {
        InferenciaAcustica.preparar(contexto)
        InferenciaAcustica.analizar(pcmBase64)
      }
    }

    // ── Firma y claves en hardware seguro (RF-3.2) ───────────────────────────
    AsyncFunction("firmarHash") Coroutine { hashHex: String ->
      withContext(Dispatchers.Default) { ClavesHardware.firmarHash(hashHex) }
    }

    AsyncFunction("obtenerDatosFirma") Coroutine { ->
      withContext(Dispatchers.Default) { ClavesHardware.obtenerDatosFirma() }
    }

    AsyncFunction("envolverDekDispositivo") Coroutine { dekHex: String ->
      withContext(Dispatchers.Default) { ClavesHardware.envolverDekDispositivo(dekHex) }
    }

    AsyncFunction("desenvolverDekDispositivo") Coroutine { envuelta: String ->
      withContext(Dispatchers.Default) { ClavesHardware.desenvolverDekDispositivo(envuelta) }
    }

    AsyncFunction("envolverDekCustodia") Coroutine { dekHex: String, clavePublicaBase64: String ->
      withContext(Dispatchers.Default) { ClavesHardware.envolverDekCustodia(dekHex, clavePublicaBase64) }
    }

    // ── Reanudación tras reinicio del teléfono (RF-2.1) ──────────────────────
    Function("marcarEscuchaActiva") { activa: Boolean ->
      ArranqueReceiver.marcarEscuchaActiva(contexto, activa)
      // Con la escucha activa, los botones de volumen también funcionan en segundo plano
      BotonesFisicos.marcarEscucha(contexto, activa)
    }
  }
}
