import React from 'react';
import Svg, {
  Defs, LinearGradient, Stop,
  Rect, Circle, Path, Ellipse, G, Line,
} from 'react-native-svg';
import { COLORS } from '../constants/colors';

const Shadow = ({ cx = 100, rx = 50, ry = 7 }) => (
  <Ellipse cx={cx} cy={180} rx={rx} ry={ry} fill="rgba(0,0,0,0.12)" />
);

function TractorIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <LinearGradient id="trBody" x1="0%" y1="0%" x2="0%" y2="100%">
          <Stop offset="0%" stopColor="#E53E3E" />
          <Stop offset="100%" stopColor="#C53030" />
        </LinearGradient>
      </Defs>
      <Shadow rx={70} />
      <Rect x="55" y="70" width="80" height="55" rx="8" fill="url(#trBody)" />
      <Rect x="50" y="55" width="40" height="25" rx="6" fill="#2D3748" />
      <Rect x="55" y="58" width="30" height="15" rx="3" fill="rgba(135,206,250,0.6)" />
      <Rect x="135" y="85" width="25" height="35" rx="5" fill="#718096" />
      <Circle cx="80" cy="145" r="30" fill="#2D3748" />
      <Circle cx="80" cy="145" r="22" fill="#4A5568" />
      <Circle cx="80" cy="145" r="6" fill="#A0AEC0" />
      {[0,60,120,180,240,300].map((a,i) => (
        <Line key={i} x1={80+6*Math.cos(a*Math.PI/180)} y1={145+6*Math.sin(a*Math.PI/180)}
              x2={80+22*Math.cos(a*Math.PI/180)} y2={145+22*Math.sin(a*Math.PI/180)}
              stroke="#A0AEC0" strokeWidth="2" />
      ))}
      <Circle cx="148" cy="155" r="18" fill="#2D3748" />
      <Circle cx="148" cy="155" r="12" fill="#4A5568" />
      <Circle cx="148" cy="155" r="4" fill="#A0AEC0" />
      <Rect x="40" y="95" width="18" height="6" rx="3" fill="#718096" />
      <Circle cx="92" cy="60" r="4" fill="#ECC94B" />
    </Svg>
  );
}

function HarvesterIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <LinearGradient id="hvBody" x1="0%" y1="0%" x2="0%" y2="100%">
          <Stop offset="0%" stopColor="#48BB78" />
          <Stop offset="100%" stopColor="#276749" />
        </LinearGradient>
      </Defs>
      <Shadow rx={75} />
      <Rect x="30" y="60" width="110" height="70" rx="10" fill="url(#hvBody)" />
      <Rect x="35" y="45" width="45" height="25" rx="5" fill="#2D3748" />
      <Rect x="40" y="48" width="35" height="16" rx="3" fill="rgba(135,206,250,0.5)" />
      <Rect x="140" y="75" width="30" height="45" rx="6" fill="#276749" />
      <Rect x="140" y="120" width="30" height="15" rx="3" fill="#E53E3E" />
      <Circle cx="55" cy="150" r="24" fill="#2D3748" />
      <Circle cx="55" cy="150" r="16" fill="#4A5568" />
      <Circle cx="55" cy="150" r="5" fill="#A0AEC0" />
      <Circle cx="120" cy="150" r="24" fill="#2D3748" />
      <Circle cx="120" cy="150" r="16" fill="#4A5568" />
      <Circle cx="120" cy="150" r="5" fill="#A0AEC0" />
    </Svg>
  );
}

function SprayerIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={40} />
      <Rect x="70" y="50" width="60" height="80" rx="10" fill="#3182CE" />
      <Rect x="75" y="40" width="50" height="15" rx="7" fill="#2B6CB0" />
      <Path d="M80 130 L80 165 L120 165 L120 130" fill="#2B6CB0" />
      <Line x1="85" y1="165" x2="85" y2="178" stroke="#718096" strokeWidth="3" />
      <Line x1="100" y1="165" x2="100" y2="178" stroke="#718096" strokeWidth="3" />
      <Line x1="115" y1="165" x2="115" y2="178" stroke="#718096" strokeWidth="3" />
      {[82,90,98,106,114].map((x,i) => (
        <Circle key={i} cx={x+(i%2?2:-2)} cy={178+(i*1.2)} r="2" fill="#63B3ED" opacity="0.7" />
      ))}
      <Path d="M100 40 L100 25 L135 25" stroke="#718096" strokeWidth="3" fill="none" strokeLinecap="round" />
      <Circle cx="140" cy="25" r="6" fill="#63B3ED" />
      <Rect x="82" y="60" width="36" height="20" rx="4" fill="rgba(255,255,255,0.15)" />
    </Svg>
  );
}

function RotavatorIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={60} />
      <Rect x="40" y="80" width="120" height="40" rx="8" fill="#DD6B20" />
      <Rect x="45" y="72" width="30" height="15" rx="4" fill="#C05621" />
      {[60,80,100,120,140].map((cx,i) => (
        <G key={i}>
          <Circle cx={cx} cy={140} r="14" fill="#4A5568" />
          <Circle cx={cx} cy={140} r="8" fill="#2D3748" />
          {[0,90,180,270].map((a,j) => (
            <Path key={j}
              d={`M${cx+8*Math.cos(a*Math.PI/180)} ${140+8*Math.sin(a*Math.PI/180)} L${cx+14*Math.cos((a+30)*Math.PI/180)} ${140+14*Math.sin((a+30)*Math.PI/180)}`}
              stroke="#A0AEC0" strokeWidth="2" strokeLinecap="round" />
          ))}
        </G>
      ))}
      <Rect x="155" y="88" width="25" height="8" rx="4" fill="#718096" />
    </Svg>
  );
}

function ThresherIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={55} />
      <Rect x="40" y="65" width="100" height="60" rx="10" fill="#805AD5" />
      <Rect x="140" y="70" width="25" height="50" rx="6" fill="#6B46C1" />
      <Circle cx="65" cy="150" r="20" fill="#2D3748" />
      <Circle cx="65" cy="150" r="13" fill="#4A5568" />
      <Circle cx="65" cy="150" r="4" fill="#A0AEC0" />
      <Circle cx="130" cy="150" r="20" fill="#2D3748" />
      <Circle cx="130" cy="150" r="13" fill="#4A5568" />
      <Circle cx="130" cy="150" r="4" fill="#A0AEC0" />
      <Rect x="50" y="50" width="20" height="20" rx="4" fill="#2D3748" />
      <Path d="M140 75 L165 60 L170 65 L145 80" fill="#ECC94B" />
    </Svg>
  );
}

function TransplanterIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={55} />
      <Rect x="45" y="75" width="90" height="45" rx="8" fill="#38A169" />
      <Rect x="135" y="80" width="25" height="35" rx="5" fill="#276749" />
      {[55,75,95,115].map((x,i) => (
        <G key={i}>
          <Line x1={x} y1="120" x2={x} y2="160" stroke="#718096" strokeWidth="2" />
          <Path d={`M${x-6} 160 Q${x} 150 ${x+6} 160`} fill="#48BB78" />
        </G>
      ))}
      <Circle cx="70" cy="145" r="14" fill="#2D3748" />
      <Circle cx="70" cy="145" r="9" fill="#4A5568" />
      <Circle cx="145" cy="145" r="12" fill="#2D3748" />
      <Circle cx="145" cy="145" r="7" fill="#4A5568" />
    </Svg>
  );
}

function TruckIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={70} />
      <Rect x="25" y="75" width="100" height="60" rx="6" fill="#4299E1" />
      <Rect x="30" y="80" width="90" height="30" rx="3" fill="#2B6CB0" />
      <Rect x="125" y="65" width="50" height="70" rx="6" fill="#2D3748" />
      <Rect x="130" y="70" width="40" height="30" rx="4" fill="rgba(135,206,250,0.5)" />
      <Circle cx="55" cy="155" r="18" fill="#2D3748" />
      <Circle cx="55" cy="155" r="11" fill="#4A5568" />
      <Circle cx="95" cy="155" r="18" fill="#2D3748" />
      <Circle cx="95" cy="155" r="11" fill="#4A5568" />
      <Circle cx="155" cy="155" r="16" fill="#2D3748" />
      <Circle cx="155" cy="155" r="10" fill="#4A5568" />
      <Rect x="168" y="115" width="8" height="12" rx="2" fill="#E53E3E" />
      <Rect x="125" y="115" width="6" height="8" rx="2" fill="#ECC94B" />
    </Svg>
  );
}

function TempoIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={65} />
      <Rect x="30" y="80" width="85" height="55" rx="6" fill="#D69E2E" />
      <Rect x="115" y="70" width="50" height="65" rx="6" fill="#2D3748" />
      <Rect x="120" y="74" width="40" height="28" rx="3" fill="rgba(135,206,250,0.5)" />
      <Circle cx="55" cy="155" r="16" fill="#2D3748" />
      <Circle cx="55" cy="155" r="10" fill="#4A5568" />
      <Circle cx="95" cy="155" r="16" fill="#2D3748" />
      <Circle cx="95" cy="155" r="10" fill="#4A5568" />
      <Circle cx="148" cy="155" r="14" fill="#2D3748" />
      <Circle cx="148" cy="155" r="9" fill="#4A5568" />
      <Rect x="30" y="80" width="85" height="10" rx="3" fill="rgba(0,0,0,0.15)" />
    </Svg>
  );
}

const ICONS = {
  tractor: TractorIcon,
  harvester: HarvesterIcon,
  sprayer: SprayerIcon,
  rotavator: RotavatorIcon,
  thresher: ThresherIcon,
  transplanter: TransplanterIcon,
  truck: TruckIcon,
  tempo: TempoIcon,
};

export function MachineryIcon({ type, size = 48 }) {
  const Icon = ICONS[type];
  if (!Icon) return null;
  return <Icon size={size} />;
}

export default MachineryIcon;
