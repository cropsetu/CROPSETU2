/**
 * soilAdvisor — turns a saved soil report into a chat seed message.
 *
 * The "AI Soil Advisor" reuses the existing AIChat screen: we navigate to it
 * with route.params.initialMessage, which AIChat auto-sends. The farmer's farm
 * context (soil type, crops, location) is injected server-side by the backend,
 * so here we only need to feed the actual measured values + a clear question.
 */
import { PARAM_FIELDS } from './soilShared';

/**
 * Build a concise, localized seed message describing the report.
 * @param {object} report  saved soil report (has the 12 params + ratings)
 * @param {string} language active UI language code
 * @param {function} t      i18n function (key, fallback)
 * @returns {string}
 */
export function buildSoilSeedMessage(report, language, t) {
  const parts = [];
  for (const f of PARAM_FIELDS) {
    const val = report?.[f.key];
    if (val === null || val === undefined || val === '') continue;
    const rating = report?.ratings?.[f.key]?.rating;
    const unit = f.unit ? ` ${f.unit}` : '';
    parts.push(`${f.label}: ${val}${unit}${rating ? ` (${rating})` : ''}`);
  }

  const intro = t('soilHub.advisor.seedIntro', 'Here is my soil test report');
  const question = t(
    'soilHub.advisor.seedQuestion',
    'Please explain what this means for my farm and tell me exactly which fertilizers and amendments to apply, with quantities and timing.',
  );

  if (!parts.length) {
    // No saved numbers — still let the farmer talk to the advisor.
    return t(
      'soilHub.advisor.seedNoData',
      'I have not tested my soil yet. Please guide me on how to get my soil tested and what general soil care my farm needs.',
    );
  }

  return `${intro}:\n${parts.join('\n')}\n\n${question}`;
}

/** Navigate into the existing AI Chat with the report pre-loaded as context. */
export function askSoilAdvisor(navigation, report, language, t) {
  const initialMessage = buildSoilSeedMessage(report, language, t);
  navigation.navigate('AIChat', { initialMessage });
}
