import React, {createContext} from 'react';
export const SettingsKitThemeContext=createContext<unknown>(null);
export const Tooltip=({children,content,...rest}:{children:React.ReactNode;content?:React.ReactNode;[key:string]:unknown})=><span title={typeof content==='string'?content:undefined}>{children}</span>;
