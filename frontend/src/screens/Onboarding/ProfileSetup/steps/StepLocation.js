// ── Step 3 · Location — detect or type the farm address ──────────────────────
import React from 'react';
import LocationFields from '../components/LocationFields';

/**
 * @param {object} props
 * @param {{village:string,district:string,state:string,pincode:string}} props.location
 * @param {(field:string,value:string)=>void} props.onChangeField
 * @param {(coords:object|null)=>Promise<object>} props.onDetect
 */
export default function StepLocation({ location, onChangeField, onDetect }) {
  return <LocationFields values={location} onChangeField={onChangeField} onDetect={onDetect} />;
}
