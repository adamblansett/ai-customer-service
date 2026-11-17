/**
 * Multilingual Auto-Detection & Dynamic Voice Locale Router
 * Detects caller language from speech transcripts or IVR digits, selects localized
 * TTS voices (Twilio Polly + Built-In Open-Weights Kokoro-82M), generates localized
 * AI disclosure greetings, and bridges cross-lingual RAG queries.
 */

export type SupportedLocale = 'en-US' | 'es-US' | 'fr-FR' | 'de-DE' | 'pt-BR' | 'zh-CN';

export interface LocaleVoiceProfile {
  locale: SupportedLocale;
  languageName: string;
  twimlVoice: string;
  kokoroVoice: string;
  confidence: number;
  greetingText: string;
  systemPromptDirective: string;
  augmentedRagQuery: string;
}

const LOCALE_METADATA: Record<
  SupportedLocale,
  {
    languageName: string;
    twimlVoice: string;
    kokoroVoice: string;
    buildGreeting: (businessName: string) => string;
  }
> = {
  'en-US': {
    languageName: 'English',
    twimlVoice: 'Polly.Joanna',
    kokoroVoice: 'af_heart',
    buildGreeting: (biz) =>
      `Thank you for calling ${biz}. I am an automated AI assistant. This call may be recorded for quality assurance. How can I help you today?`,
  },
  'es-US': {
    languageName: 'Spanish',
    twimlVoice: 'Polly.Lupe',
    kokoroVoice: 'ef_dora',
    buildGreeting: (biz) =>
      `Gracias por llamar a ${biz}. Soy un asistente automatizado de inteligencia artificial. Esta llamada puede ser grabada. ¿En qué puedo ayudarle hoy?`,
  },
  'fr-FR': {
    languageName: 'French',
    twimlVoice: 'Polly.Lea',
    kokoroVoice: 'ff_siwis',
    buildGreeting: (biz) =>
      `Merci d'avoir appelé ${biz}. Je suis un assistant IA automatisé. Cet appel peut être enregistré. Comment puis-je vous aider aujourd'hui ?`,
  },
  'de-DE': {
    languageName: 'German',
    twimlVoice: 'Polly.Vicki',
    kokoroVoice: 'af_bella',
    buildGreeting: (biz) =>
      `Vielen Dank für Ihren Anruf bei ${biz}. Ich bin ein automatisierter KI-Assistent. Dieses Gespräch kann aufgezeichnet werden. Wie kann ich Ihnen heute helfen?`,
  },
  'pt-BR': {
    languageName: 'Portuguese',
    twimlVoice: 'Polly.Camila',
    kokoroVoice: 'af_bella',
    buildGreeting: (biz) =>
      `Obrigado por ligar para a ${biz}. Sou um assistente automatizado de IA. Esta chamada pode ser gravada. Como posso ajudá-lo hoje?`,
  },
  'zh-CN': {
    languageName: 'Mandarin Chinese',
    twimlVoice: 'Polly.Zhiyu',
    kokoroVoice: 'zf_xiaobei',
    buildGreeting: (biz) =>
      `感谢您致电 ${biz}。我是人工智能语音助手，通话可能会被录音。请问今天有什么可以帮您？`,
  },
};

const LANGUAGE_LEXICONS: Record<Exclude<SupportedLocale, 'en-US' | 'zh-CN'>, string[]> = {
  'es-US': [
    'hola',
    'buenos',
    'buenas',
    'necesito',
    'ayuda',
    'calefacción',
    'calefaccion',
    'calentador',
    'horno',
    'aire',
    'acondicionado',
    'precio',
    'cuánto',
    'cuanto',
    'cuesta',
    'horario',
    'horarios',
    'abierto',
    'emergencia',
    'urgente',
    'hablar',
    'agente',
    'humano',
    'español',
    'espanol',
    'gracias',
    'cita',
    'técnico',
    'tecnico',
  ],
  'fr-FR': [
    'bonjour',
    'bonsoir',
    'besoin',
    'aide',
    'chauffage',
    'fournaise',
    'climatisation',
    'combien',
    'prix',
    'tarif',
    'horaires',
    'ouvert',
    'urgence',
    'merci',
    'français',
    'francais',
    'rendez-vous',
    'technicien',
    'parler',
    'humain',
  ],
  'de-DE': [
    'hallo',
    'guten',
    'hilfe',
    'heizung',
    'klimaanlage',
    'kosten',
    'preis',
    'notfall',
    'termin',
    'danke',
    'deutsch',
    'öffnungszeiten',
    'oeffnungszeiten',
    'techniker',
    'mensch',
    'sprechen',
  ],
  'pt-BR': [
    'olá',
    'ola',
    'preciso',
    'ajuda',
    'aquecimento',
    'aquecedor',
    'preço',
    'preco',
    'horário',
    'horario',
    'emergência',
    'emergencia',
    'obrigado',
    'obrigada',
    'português',
    'portugues',
    'agendar',
    'técnico',
  ],
};

/**
 * Cross-lingual keyword bridge so non-English caller utterances match English RAG documents.
 */
const CROSS_LINGUAL_RAG_SYNONYMS: Array<{ patterns: RegExp; englishTerms: string }> = [
  {
    patterns: /calefacci[oó]n|calentador|horno|chauffage|fournaise|heizung|aquecimento|aquecedor|暖气|锅炉/i,
    englishTerms: 'heating furnace emergency repair',
  },
  {
    patterns: /aire acondicionado|climatisation|klimaanlage|ar condicionado|空调/i,
    englishTerms: 'ac air conditioner tune-up cooling',
  },
  {
    patterns: /precio|cu[aá]nto|cuesta|tarif|combien|prix|kosten|preis|pre[cç]o|价格|多少钱|费用/i,
    englishTerms: 'pricing diagnostic fee cost rate 89 129 119',
  },
  {
    patterns: /horario|abierto|horaires|ouvert|[oö]ffnungszeiten|hor[aá]rio|营业时间|几点/i,
    englishTerms: 'standard operating hours monday friday saturday schedule',
  },
  {
    patterns: /emergencia|urgente|urgence|notfall|emerg[eê]ncia|紧急|急修/i,
    englishTerms: 'emergency heating failure freezing 24/7 dispatch technician',
  },
  {
    patterns: /cita|t[eé]cnico|rendez-vous|termin|agendar|预约|技师/i,
    englishTerms: 'appointment schedule technician dispatch',
  },
];

export class LanguageRouter {
  /**
   * Detects caller language from an utterance or IVR DTMF press and returns
   * voice configuration, localized greeting, system prompt directive, and cross-lingual RAG query.
   */
  public detectAndRoute(
    utterance: string,
    options?: { businessName?: string; dtmfDigit?: string }
  ): LocaleVoiceProfile {
    const businessName = options?.businessName || 'Acme HVAC';
    let detectedLocale: SupportedLocale = 'en-US';
    let confidence = 0.9;

    // 1. Check explicit IVR digit override
    if (options?.dtmfDigit === '9') {
      detectedLocale = 'es-US';
      confidence = 1.0;
    } else if (/[\u4e00-\u9fa5]/.test(utterance)) {
      detectedLocale = 'zh-CN';
      confidence = 0.98;
    } else {
      const normalized = utterance
        .toLowerCase()
        .replace(/[¿¡.,!?;"'()]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);

      let bestLocale: SupportedLocale = 'en-US';
      let bestHits = 0;

      for (const [locale, words] of Object.entries(LANGUAGE_LEXICONS) as Array<
        [Exclude<SupportedLocale, 'en-US' | 'zh-CN'>, string[]]
      >) {
        const wordSet = new Set(words);
        let hits = 0;
        for (const token of normalized) {
          if (wordSet.has(token)) {
            hits++;
          }
        }
        if (hits > bestHits) {
          bestHits = hits;
          bestLocale = locale;
        }
      }

      if (bestHits > 0) {
        detectedLocale = bestLocale;
        confidence = Math.min(0.99, 0.75 + bestHits * 0.08);
      }
    }

    const meta = LOCALE_METADATA[detectedLocale];
    const augmentedRagQuery = this.buildCrossLingualRagQuery(utterance);

    return {
      locale: detectedLocale,
      languageName: meta.languageName,
      twimlVoice: meta.twimlVoice,
      kokoroVoice: meta.kokoroVoice,
      confidence,
      greetingText: meta.buildGreeting(businessName),
      systemPromptDirective:
        detectedLocale === 'en-US'
          ? 'Respond clearly and concisely in English.'
          : `IMPORTANT MULTILINGUAL DIRECTIVE: The customer is speaking ${meta.languageName} (${detectedLocale}). You MUST respond naturally in ${meta.languageName}, translating any relevant facts from the approved business knowledge base accurately into ${meta.languageName}.`,
      augmentedRagQuery,
    };
  }

  /**
   * Appends English domain keywords when non-English HVAC/service terms are detected
   * so the tenant's English knowledge base chunks are retrieved with high confidence.
   */
  public buildCrossLingualRagQuery(utterance: string): string {
    const extraTerms: string[] = [];
    for (const rule of CROSS_LINGUAL_RAG_SYNONYMS) {
      if (rule.patterns.test(utterance)) {
        extraTerms.push(rule.englishTerms);
      }
    }
    if (extraTerms.length === 0) {
      return utterance;
    }
    return `${utterance} ${extraTerms.join(' ')}`;
  }

  public listSupportedLocales() {
    return Object.entries(LOCALE_METADATA).map(([locale, meta]) => ({
      locale,
      languageName: meta.languageName,
      twimlVoice: meta.twimlVoice,
      kokoroVoice: meta.kokoroVoice,
    }));
  }
}
