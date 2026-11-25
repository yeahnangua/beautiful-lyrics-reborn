import React from 'react';
import { useTranslation } from 'react-i18next';
import { tuningDefinitions, type TuningValues } from './tunings';
import controlSchema from './tuning-schema.json';
import chineseLabels from './tuning-labels.zh.json';
import { toggleMachiCameraBar } from '../vendor/src/components/visualizer/machi/cameraBar';

type Field = { type: string; choices?: (string | number)[]; fields?: Record<string, Field>; item?: Field };
const commonChinese:Record<string,string>={render:'渲染',scale:'分辨率',antialias:'抗锯齿',fontScale:'字号',motionAmount:'运动强度',glowIntensity:'发光强度',widthRatio:'宽度比例',beamIntensity:'光束强度',showEmoMessages:'显示表情',avatarSource:'头像来源',emojiPackSource:'表情来源',enableWordRotation:'文字旋转',breathingFloatMultiplier:'呼吸浮动',useLegacyLayout:'经典排版',wordSpacing:'词间距',avoidOverlap:'避免重叠',credits:'片尾信息',appear:'出现方式',fade:'消失方式',layouts:'构图',behind:'窗外场景',glass:'玻璃效果',scenery:'场景元素',rain:'雨景',mist:'雾气',hold:'保留时间',refog:'重新起雾',strokeWidth:'笔画宽度',writeSpeed:'书写速度',jitter:'抖动',warp:'扭曲',doodle:'涂鸦',quality:'画质',adaptive:'自动调整画质',renderQuality:'渲染质量'};
const schemas = controlSchema as Record<string, Record<string, Field>>;
const label = (name: string) => name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
export function TuningPanel({ name, values, change, close }: { name: string; values: TuningValues; change(key: string, patch?: Record<string, unknown>): void; close?():void }) {
  const { t, i18n } = useTranslation();
  const translations = (chineseLabels as Record<string,Record<string,string>>)[name] ?? {};
  const definition = tuningDefinitions().find(item => item.key === name)?.definition;
  if (!definition || !values[name]) return null;
  const schema = schemas[name] ?? {};
  const fields = (value: Record<string, unknown>, shape: Record<string, Field>, prefix: string, apply: (patch: Record<string, unknown>) => void): React.ReactNode =>
    Object.entries(value).map(([key, current]) => {
      if (['images', 'views', 'customImages', 'portraitImage'].includes(key)) return null;
      const field = shape[key], title = i18n.language.startsWith('zh') ? translations[key] ?? commonChinese[key] ?? label(key) : label(key), id = prefix + key;
      if (current && typeof current === 'object' && !Array.isArray(current)) return <details key={key}><summary>{title}</summary>{fields(current as Record<string, unknown>, field?.fields ?? {}, id + '.', patch => apply({ [key]: { ...(current as object), ...patch } }))}</details>;
      if (Array.isArray(current)) {
        if (!field?.item?.choices) return null;
        return <fieldset key={key}><legend>{title}</legend>{field.item.choices.map(option => <label className="folia-checkbox" key={option}><span>{label(String(option))}</span><input type="checkbox" checked={current.includes(option)} onChange={event => apply({ [key]: event.target.checked ? [...current, option] : current.filter(item => item !== option) })} /></label>)}</fieldset>;
      }
      if (typeof current === 'boolean') return <label className="folia-checkbox" key={key}><span>{title}</span><input aria-label={id} type="checkbox" checked={current} onChange={event => apply({ [key]: event.target.checked })} /></label>;
      if (field?.choices?.length) return <label key={key}>{title}<select aria-label={id} value={String(current)} onChange={event => apply({ [key]: field.choices!.find(option => String(option) === event.target.value) })}>{field.choices.filter(option => !['custom','uploaded-global'].includes(String(option)) || current === option).map(option => <option key={option} value={String(option)}>{label(String(option))}</option>)}</select></label>;
      if (typeof current === 'number') return <label key={key}>{title}<input aria-label={id} type="number" step="any" value={current} onChange={event => { const number = event.target.valueAsNumber; if (Number.isFinite(number)) apply({ [key]: number }); }} /></label>;
      if (typeof current === 'string') return <label key={key}>{title}<input aria-label={id} type={/^#[\da-f]{6}$/i.test(current) ? 'color' : 'text'} value={current} onChange={event => apply({ [key]: event.target.value })} /></label>;
      return null;
    });
  return <details className="folia-tuning"><summary>{name.startsWith('background:') ? t('backgroundParameters') : t('modeParameters')}</summary>
    {name === 'machi' && <button type="button" onClick={()=>{toggleMachiCameraBar();close?.()}}>{t('camera')}</button>}
    {fields(values[name], schema, name + '.', patch => change(name, patch))}
    <button type="button" onClick={() => change(name)}>{t('reset')}</button>
  </details>;
}
