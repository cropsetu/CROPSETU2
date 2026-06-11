// ── Step 2 · Language — visual single-select ─────────────────────────────────
import React from 'react';
import LanguageSelect from '../components/LanguageSelect';

/**
 * @param {object} props
 * @param {string} props.language
 * @param {(code:string)=>void} props.onChangeLanguage
 */
export default function StepLanguage({ language, onChangeLanguage }) {
  return <LanguageSelect value={language} onChange={onChangeLanguage} />;
}
