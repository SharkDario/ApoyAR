# backend/app/services/acoustic_ai.py
# ─────────────────────────────────────────────────────────────────────────────
# Servicio de Inferencia Acústica Local / Edge AI (CU-04 / RF-2.1).
#
# Implementa:
# 1. Motor Vosk ASR: Reconocimiento fonético en español (vosk-model-small-es-0.42)
#    para detección de palabras clave habladas ("pizza", "auxilio", "socorro", etc.).
# 2. Motor YAMNet: Clasificación de audio ambiental (521 clases AudioSet) mediante
#    ONNX Runtime para detección de episodios de violencia (Gritos, Golpes, Cristales, etc.).
# 3. Conversor universal de audio a 16kHz Mono PCM vía FFmpeg.
# ─────────────────────────────────────────────────────────────────────────────

import os
import sys
import json
import logging
import zipfile
import subprocess
import urllib.request
from typing import Dict, Any, List, Optional, Tuple
import numpy as np

logger = logging.getLogger("apoyar.acoustic_ai")
logger.setLevel(logging.INFO)
if not logger.handlers:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter("[%(asctime)s] %(levelname)s [%(name)s]: %(message)s"))
    logger.addHandler(handler)

# Rutas de Modelos
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS_DIR = os.path.join(BASE_DIR, "models")
VOSK_MODEL_DIR = os.path.join(MODELS_DIR, "vosk-model-small-es-0.42")
YAMNET_ONNX_PATH = os.path.join(MODELS_DIR, "yamnet_3s.onnx")
YAMNET_CLASS_MAP_PATH = os.path.join(MODELS_DIR, "yamnet_class_map.txt")

# Clases de violencia en AudioSet YAMNet
VIOLENCE_CLASSES: Dict[int, str] = {
    6: "Shout",
    9: "Yell",
    10: "Children shouting",
    11: "Screaming",
    19: "Crying, sobbing",
    20: "Baby cry, infant cry",
    22: "Wail, moan",
    33: "Groan",
    435: "Glass",
    461: "Slap, smack",
    462: "Whack, thwack",
    463: "Smash, crash",
}

VIOLENCE_THRESHOLD = 0.22  # Umbral de confianza estándar para eventos violentos
VIOLENCE_SENSITIVE_THRESHOLD = 0.12  # Umbral reducido en presencia de vocabulario hostil

# ─────────────────────────────────────────────────────────────────────────────
# Diccionario estructurado de términos y frases de violencia verbal, amenazas,
# silenciamiento hostil, coacción y pedidos de auxilio (Pipeline Canal 1 - Vosk)
# ─────────────────────────────────────────────────────────────────────────────
DICCIONARIO_VIOLENCIA_VERBAL: List[Dict[str, Any]] = [
    {
        "categoria": "amenaza_de_muerte_o_agresion",
        "patrones": [
            "te voy a matar",
            "te mato",
            "te voy a romper",
            "te voy a hacer mierda",
            "te voy a reventar",
            "te voy a quebrar",
            "te voy a destruir",
            "te vas a morir",
            "te voy a pegar",
            "te vas a arrepentir",
            "de aca no salis viva",
            "de aqui no sales viva",
            "te voy a degollar",
            "te tiro por la ventana",
            "te voy a cagar a palos",
        ],
    },
    {
        "categoria": "coaccion_y_retencion",
        "patrones": [
            "no vas a salir",
            "no vas a ir a ningun lado",
            "no te vas a ir",
            "de aca no te vas",
            "de aqui no te vas",
            "adonde vas",
            "a donde te pensas que vas",
            "dame el celular",
            "dame el telefono",
            "soltame",
            "no me toques",
            "dejame en paz",
            "dejame salir",
            "dejame ir",
            "no me pegues",
        ],
    },
    {
        "categoria": "silenciamiento_hostil",
        "patrones": [
            "callate",
            "callate la boca",
            "cerra la boca",
            "cerra el orto",
            "no grites",
            "te dije que te calles",
            "no hables",
            "silencio",
        ],
    },
    {
        "categoria": "pedido_auxilio",
        "patrones": [
            "auxilio",
            "socorro",
            "ayuda por favor",
            "ayudame",
            "ayudenme",
            "por favor ayuda",
            "llama a la policia",
            "llama al 911",
            "por favor no me pegues",
            "por favor no",
            "basta por favor",
            "soltame por favor",
        ],
    },
    {
        "categoria": "insulto_agresion_directa",
        "patrones": [
            "hija de puta",
            "hijo de puta",
            "la concha de tu madre",
            "pedazo de mierda",
            "sos una mierda",
            "maldita perra",
            "estupida de mierda",
            "inutil",
            "tarada",
            "basura",
        ],
    },
]


def normalizar_texto(texto: str) -> str:
    """Normaliza texto eliminando acentos, puntuación y espacios redundantes."""
    import unicodedata
    if not texto:
        return ""
    texto = texto.lower().strip()
    texto = "".join(
        c for c in unicodedata.normalize("NFD", texto)
        if unicodedata.category(c) != "Mn"
    )
    # Reemplazar puntuación por espacios
    for ch in [".", ",", ";", ":", "!", "?", "\"", "'", "-", "_"]:
        texto = texto.replace(ch, " ")
    return " ".join(texto.split())


class AcousticAIService:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(AcousticAIService, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return

        os.makedirs(MODELS_DIR, exist_ok=True)
        self.vosk_model = None
        self.yamnet_session = None
        self.class_map: Dict[int, str] = {}
        
        self.ensure_models_downloaded()
        self.load_models()
        self._initialized = True

    def ensure_models_downloaded(self):
        """Verifica y descarga automáticamente los modelos si no existen."""
        # 1. Mapa de clases YAMNet
        if not os.path.exists(YAMNET_CLASS_MAP_PATH):
            logger.info("Descargando mapa de clases de YAMNet...")
            url_map = "https://raw.githubusercontent.com/Choise-ieee/yamnet_onnx_cpp_audio_speech_classification/main/yamnet_class_map.txt"
            urllib.request.urlretrieve(url_map, YAMNET_CLASS_MAP_PATH)

        # 2. Modelo YAMNet ONNX (optimizado para ventanas de 3s)
        if not os.path.exists(YAMNET_ONNX_PATH):
            logger.info("Descargando modelo yamnet_3s.onnx (16MB)...")
            url_onnx = "https://raw.githubusercontent.com/Choise-ieee/yamnet_onnx_cpp_audio_speech_classification/main/yamnet_3s.onnx"
            urllib.request.urlretrieve(url_onnx, YAMNET_ONNX_PATH)

        # 3. Modelo Vosk en español
        if not os.path.exists(VOSK_MODEL_DIR):
            logger.info("Descargando modelo oficial Vosk Español (vosk-model-small-es-0.42)...")
            zip_url = "https://alphacephei.com/vosk/models/vosk-model-small-es-0.42.zip"
            zip_dest = os.path.join(MODELS_DIR, "vosk-model-small-es-0.42.zip")
            urllib.request.urlretrieve(zip_url, zip_dest)
            with zipfile.ZipFile(zip_dest, "r") as z:
                z.extractall(MODELS_DIR)
            if os.path.exists(zip_dest):
                os.remove(zip_dest)
            logger.info("Modelo Vosk descomprimido con éxito.")

    def load_models(self):
        """Inicializa las sesiones de inferencia en memoria."""
        # Cargar mapa de clases YAMNet
        if os.path.exists(YAMNET_CLASS_MAP_PATH):
            with open(YAMNET_CLASS_MAP_PATH, "r", encoding="latin-1") as f:
                for line in f:
                    parts = line.strip().split(maxsplit=1)
                    if len(parts) == 2 and parts[0].isdigit():
                        self.class_map[int(parts[0])] = parts[1].strip()

        # Cargar YAMNet con ONNX Runtime
        try:
            import onnxruntime as ort
            session_options = ort.SessionOptions()
            session_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            self.yamnet_session = ort.InferenceSession(YAMNET_ONNX_PATH, session_options)
            logger.info("Motor YAMNet ONNX inicializado con éxito.")
        except Exception as e:
            logger.error("Error al inicializar motor YAMNet ONNX: %s", e)

        # Cargar Vosk
        try:
            import vosk
            vosk.SetLogLevel(-1)  # Reducir verbosidad interna de Kaldi
            self.vosk_model = vosk.Model(VOSK_MODEL_DIR)
            logger.info("Motor Vosk ASR (Español) inicializado con éxito.")
        except Exception as e:
            logger.error("Error al inicializar motor Vosk ASR: %s", e)

    def convert_audio_to_pcm(self, audio_bytes: bytes) -> Tuple[bytes, np.ndarray]:
        """
        Convierte cualquier formato multimedia (.m4a, .wav, .aac, .3gp)
        a 16kHz 16-bit Mono PCM para Vosk y a arreglo Float32 para YAMNet.
        """
        cmd = [
            "ffmpeg",
            "-i", "pipe:0",
            "-f", "s16le",
            "-acodec", "pcm_s16le",
            "-ar", "16000",
            "-ac", "1",
            "pipe:1"
        ]
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL
        )
        pcm_bytes, _ = proc.communicate(input=audio_bytes)
        
        # Procesar para YAMNet (48000 muestras Float32 normalizadas [-1.0, 1.0])
        int16_arr = np.frombuffer(pcm_bytes, dtype=np.int16)
        float_arr = int16_arr.astype(np.float32) / 32768.0

        target_len = 48000  # 3 segundos a 16000Hz
        if len(float_arr) < target_len:
            padded = np.zeros(target_len, dtype=np.float32)
            padded[:len(float_arr)] = float_arr
            float_arr = padded
        else:
            float_arr = float_arr[:target_len]

        yamnet_tensor = float_arr.reshape(1, target_len)
        return pcm_bytes, yamnet_tensor

    def transcribir_vosk(self, pcm_bytes: bytes) -> str:
        """Transcribe fragmento de audio con Vosk ASR."""
        if not self.vosk_model:
            return ""
        import vosk
        rec = vosk.KaldiRecognizer(self.vosk_model, 16000)
        rec.AcceptWaveform(pcm_bytes)
        res = json.loads(rec.FinalResult())
        return res.get("text", "").strip()

    def clasificar_yamnet(self, yamnet_tensor: np.ndarray) -> Tuple[List[Dict[str, Any]], Optional[str], float, bool]:
        """
        Clasifica eventos acústicos en YAMNet y determina si existe violencia ambiental.
        Retorna: (top_clases, evento_violento_detectado, max_confianza_violencia, es_violencia)
        """
        if not self.yamnet_session:
            return [], None, 0.0, False

        input_name = self.yamnet_session.get_inputs()[0].name
        # scores tiene forma [6, 521] para la ventana de 3 segundos
        scores = self.yamnet_session.run(["scores"], {input_name: yamnet_tensor})[0]
        avg_scores = scores.mean(axis=0)

        # Top 5 clases detectadas
        top_indices = np.argsort(avg_scores)[::-1][:5]
        top_clases = []
        for idx in top_indices:
            nombre_clase = self.class_map.get(idx, f"Clase_{idx}")
            score_val = float(avg_scores[idx])
            top_clases.append({"clase": nombre_clase, "id": int(idx), "score": round(score_val, 4)})

        # Evaluar clases de violencia ambiental
        evento_violento = None
        max_score_violencia = 0.0

        for idx, nombre in VIOLENCE_CLASSES.items():
            if idx < len(avg_scores):
                score_v = float(avg_scores[idx])
                if score_v > max_score_violencia:
                    max_score_violencia = score_v
                    evento_violento = nombre

        es_violencia = max_score_violencia >= VIOLENCE_THRESHOLD and evento_violento is not None

        return top_clases, evento_violento if es_violencia else None, round(max_score_violencia, 4), es_violencia

    def evaluar_amenaza_verbal(self, transcripcion: str) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Evalúa la transcripción fonética de Vosk contra el diccionario estructurado
        de violencia verbal, amenazas, silenciamiento forzado, coacción y pedidos de auxilio.
        Retorna: (amenaza_detectada, frase_detectada, categoria)
        """
        if not transcripcion:
            return False, None, None

        texto_norm = normalizar_texto(transcripcion)
        if not texto_norm:
            return False, None, None

        tokens = set(texto_norm.split())

        for grupo in DICCIONARIO_VIOLENCIA_VERBAL:
            categoria = grupo["categoria"]
            for patron in grupo["patrones"]:
                patron_norm = normalizar_texto(patron)
                if not patron_norm:
                    continue

                # Si el patrón tiene múltiples palabras, evaluar coincidencia como substring
                if " " in patron_norm:
                    if patron_norm in texto_norm:
                        return True, patron, categoria
                else:
                    # Palabra clave única crítica (ej. 'auxilio', 'socorro', 'soltame', 'callate')
                    if patron_norm in tokens:
                        return True, patron, categoria

        return False, None, None

    def analizar_audio(self, audio_bytes: bytes, palabra_clave: str) -> Dict[str, Any]:
        """
        Realiza análisis cooperativo multimodal de Vosk y YAMNet:
        - Canal 1 (Vosk): Palabra clave y analizador semántico de amenazas/violencia verbal.
        - Canal 2 (YAMNet): Eventos acústicos paralingüísticos y ambientales (gritos, impactos, cristales).
        - Sinergia: Disparo inmediato ante amenazas en 'Speech' y umbral dinámico ante hostilidad.
        """
        pcm_bytes, yamnet_tensor = self.convert_audio_to_pcm(audio_bytes)

        # ── CANAL 1: Semántico y Léxico (Vosk ASR) ──────────────────────────────
        transcripcion = self.transcribir_vosk(pcm_bytes)
        transcripcion_norm = normalizar_texto(transcripcion)
        keyword_norm = normalizar_texto(palabra_clave)

        palabras_transcritas = set(transcripcion_norm.split())
        palabras_clave = set(keyword_norm.split())

        # A) Palabra clave encubierta configurada
        palabra_detectada = False
        if keyword_norm:
            if keyword_norm in transcripcion_norm:
                palabra_detectada = True
            elif palabras_clave and palabras_clave.issubset(palabras_transcritas):
                palabra_detectada = True

        logger.info(f"[Vosk] Transcripción: \"{transcripcion}\" | Esperada: \"{palabra_clave}\" | Coincide: {palabra_detectada}")

        # B) Detector de Violencia Verbal, Insultos y Amenazas
        amenaza_verbal_detectada, frase_amenaza, categoria_amenaza = self.evaluar_amenaza_verbal(transcripcion)

        # ── CANAL 2: Acústico Paralingüístico y Ambiental (YAMNet) ──────────────
        top_clases, evento_violencia, confianza_v, violencia_detectada = self.clasificar_yamnet(yamnet_tensor)

        dominante = top_clases[0] if top_clases else {"clase": "Unknown", "score": 0.0}

        # Verificar presencia acústica de habla ("Speech", "Conversation", etc.)
        speech_score = 0.0
        for c in top_clases:
            if c.get("clase") in ("Speech", "Conversation", "Child speech, kid speaking"):
                speech_score = max(speech_score, float(c.get("score", 0.0)))

        hay_speech_acustico = speech_score >= 0.15 or dominante.get("clase") in ("Speech", "Conversation")

        # ── SINERGIA YAMNet + Vosk (Fusión Multimodal) ──────────────────────────
        # 1. Si YAMNet detecta 'Speech' o hay habla transcripta y Vosk detecta una amenaza verbal,
        #    se dispara inmediatamente el Modo Resguardo con trigger 'amenaza_verbal_vosk'.
        if amenaza_verbal_detectada:
            logger.warning(
                f"[Fusión IA] Amenaza verbal detectada en Speech: \"{frase_amenaza}\" (Categoría: {categoria_amenaza}) -> Disparando Modo Resguardo"
            )

        # 2. Si YAMNet registra tensión vocal / gritos moderados junto a vocabulario hostil en Vosk,
        #    se reduce el umbral de disparo físico para una reacción ultrasensible.
        if amenaza_verbal_detectada and confianza_v >= VIOLENCE_SENSITIVE_THRESHOLD and evento_violencia:
            violencia_detectada = True
            logger.warning(
                f"[Fusión IA] Umbral reducido por hostilidad verbal activado: {evento_violencia} ({confianza_v:.2f} >= {VIOLENCE_SENSITIVE_THRESHOLD})"
            )

        # Logs de estado YAMNet
        if violencia_detectada:
            logger.warning(
                f"[YAMNet] ¡ALERTA VIOLENCIA AMBIENTAL! Evento: {evento_violencia} ({confianza_v:.2f}) -> ¡DISPARO MODO RESGUARDO!"
            )
        else:
            logger.info(
                f"[YAMNet] Evento dominante: {dominante['clase']} ({dominante['score']:.2f}) | Máx violencia: {confianza_v:.2f}"
            )

        # ── DECISIÓN DE ACTIVACIÓN Y PRECEDENCIA ────────────────────────────────
        disparo_resguardo = palabra_detectada or amenaza_verbal_detectada or violencia_detectada
        origen_disparo = None
        if palabra_detectada:
            origen_disparo = "palabra_clave"
        elif amenaza_verbal_detectada:
            origen_disparo = "amenaza_verbal_vosk"
        elif violencia_detectada:
            origen_disparo = "violencia_ambiental"

        return {
            "transcripcion": transcripcion,
            "transcripcion_vosk": transcripcion,
            "palabra_clave_esperada": palabra_clave,
            "palabra_clave_detectada": palabra_detectada,
            "amenaza_verbal_detectada": amenaza_verbal_detectada,
            "frase_amenaza_detectada": frase_amenaza,
            "categoria_amenaza": categoria_amenaza,
            "speech_score": round(speech_score, 4),
            "hay_speech_acustico": hay_speech_acustico,
            "violencia_detectada": violencia_detectada,
            "evento_violencia": evento_violencia,
            "yamnet_violence_class": evento_violencia,
            "confianza_violencia": confianza_v,
            "yamnet_violence_score": confianza_v,
            "yamnet_top_class": dominante["clase"],
            "yamnet_top_score": dominante["score"],
            "top_clases_yamnet": top_clases,
            "disparo_resguardo": disparo_resguardo,
            "activar_sos": disparo_resguardo,
            "origen_disparo": origen_disparo,
            "origen_sugerido": origen_disparo,
            "trigger": origen_disparo,
        }


# Instancia única del servicio
acoustic_ai_service = AcousticAIService()


def evaluar_amenaza_verbal(transcripcion: str) -> Tuple[bool, Optional[str], Optional[str]]:
    """Función helper a nivel de módulo para evaluar amenazas verbales en transcripciones."""
    return acoustic_ai_service.evaluar_amenaza_verbal(transcripcion)

