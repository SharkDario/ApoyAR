package expo.modules.apoyarnativo

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.util.Base64
import org.json.JSONObject
import org.vosk.LibVosk
import org.vosk.LogLevel
import org.vosk.Model
import org.vosk.Recognizer
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer

/** Vosk y YAMNet dentro del teléfono: el audio analizado nunca sale del dispositivo. */
object InferenciaAcustica {
  private const val CARPETA_VOSK = "vosk-model-small-es-0.42"
  private const val MODELO_YAMNET = "yamnet_3s.onnx"
  private const val MAPA_CLASES = "yamnet_class_map.txt"
  private const val MUESTRAS_YAMNET = 48000
  private const val FRECUENCIA_HZ = 16000f
  private const val TOP_CLASES = 5

  private var entorno: OrtEnvironment? = null
  private var sesion: OrtSession? = null
  private var modeloVosk: Model? = null
  private var clases: Map<Int, String> = emptyMap()

  @Synchronized
  fun preparar(contexto: Context) {
    if (sesion != null && modeloVosk != null) return

    if (entorno == null) entorno = OrtEnvironment.getEnvironment()
    if (sesion == null) {
      val modelo = contexto.assets.open(MODELO_YAMNET).use { it.readBytes() }
      sesion = entorno!!.createSession(modelo, OrtSession.SessionOptions())
    }
    if (clases.isEmpty()) {
      clases = contexto.assets.open(MAPA_CLASES).bufferedReader(Charsets.ISO_8859_1).useLines { lineas ->
        lineas.mapNotNull { linea ->
          val partes = linea.trim().split(Regex("\\s+"), 2)
          partes.takeIf { it.size == 2 }?.get(0)?.toIntOrNull()?.let { it to partes[1].trim() }
        }.toMap()
      }
    }
    if (modeloVosk == null) {
      LibVosk.setLogLevel(LogLevel.WARNINGS)
      modeloVosk = Model(extraerVosk(contexto).absolutePath)
    }
  }

  /** PCM mono 16 kHz de 16 bits en Base64. Devuelve transcripción y puntajes por clase de AudioSet. */
  @Synchronized
  fun analizar(pcmBase64: String): Map<String, Any> {
    val pcm = Base64.decode(pcmBase64, Base64.NO_WRAP)
    val puntajes = clasificar(pcm)
    val top = puntajes.indices.sortedByDescending { puntajes[it] }.take(TOP_CLASES).map { indice ->
      mapOf(
        "id" to indice,
        "clase" to (clases[indice] ?: "Clase_$indice"),
        "score" to puntajes[indice].toDouble(),
      )
    }
    return mapOf(
      "transcripcion" to transcribir(pcm),
      "top_clases" to top,
      "puntajes" to puntajes.map { it.toDouble() },
    )
  }

  private fun transcribir(pcm: ByteArray): String =
    Recognizer(modeloVosk, FRECUENCIA_HZ).use { reconocedor ->
      reconocedor.acceptWaveForm(pcm, pcm.size)
      JSONObject(reconocedor.finalResult).optString("text").trim()
    }

  private fun clasificar(pcm: ByteArray): FloatArray {
    val muestras = FloatArray(MUESTRAS_YAMNET)
    val entrada = ByteBuffer.wrap(pcm).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
    for (i in 0 until minOf(entrada.remaining(), MUESTRAS_YAMNET)) {
      muestras[i] = entrada.get(i) / 32768f
    }

    val motor = sesion!!
    val nombreEntrada = motor.inputNames.first()
    val forma = longArrayOf(1, MUESTRAS_YAMNET.toLong())
    return OnnxTensor.createTensor(entorno, FloatBuffer.wrap(muestras), forma).use { tensor ->
      motor.run(mapOf(nombreEntrada to tensor), setOf("scores")).use { resultado ->
        @Suppress("UNCHECKED_CAST")
        promediar(resultado[0].value as Array<FloatArray>)
      }
    }
  }

  private fun promediar(cuadros: Array<FloatArray>): FloatArray {
    val promedio = FloatArray(cuadros[0].size)
    for (cuadro in cuadros) {
      for (i in cuadro.indices) promedio[i] += cuadro[i] / cuadros.size
    }
    return promedio
  }

  /** Vosk necesita rutas de archivo reales, por eso el modelo se copia una vez desde los assets. */
  private fun extraerVosk(contexto: Context): File {
    val destino = File(contexto.filesDir, CARPETA_VOSK)
    val marca = File(destino, ".extraido")
    if (!marca.exists()) {
      destino.deleteRecursively()
      copiarAssets(contexto, CARPETA_VOSK, destino)
      marca.createNewFile()
    }
    return destino
  }

  private fun copiarAssets(contexto: Context, ruta: String, destino: File) {
    val hijos = contexto.assets.list(ruta).orEmpty()
    if (hijos.isEmpty()) {
      destino.parentFile?.mkdirs()
      contexto.assets.open(ruta).use { entrada -> destino.outputStream().use { entrada.copyTo(it) } }
      return
    }
    destino.mkdirs()
    hijos.forEach { copiarAssets(contexto, "$ruta/$it", File(destino, it)) }
  }
}
