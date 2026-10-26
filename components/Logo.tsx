import { t, translateText, contentText, getLocale } from '../i18n/runtime';
import React from 'react';

export const Logo: React.FC<{ className?: string, showText?: boolean }> = ({ className = "w-10 h-10", showText = true }) => {
  return (
    <div className="flex items-center gap-3 select-none group">
        <div className={`relative flex items-center justify-center ${className} rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 shadow-lg text-white shrink-0 overflow-hidden transition-transform group-hover:scale-105 duration-300`}>
             {/* Background Effects */}
            <div className="absolute top-0 right-0 w-full h-full bg-white opacity-10" style={{ clipPath: 'circle(50% at 100% 0)' }}></div>
            
            {/* Logo Icon: Stylized DNA/Heart Shield */}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6 z-10 relative">
               <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4" />
               <path strokeLinecap="round" strokeLinejoin="round" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" className="opacity-90"/>
            </svg>
        </div>
        {showText && (
            <div className="flex flex-col justify-center">
                <span className="font-extrabold text-xl text-gray-900 leading-none tracking-tight">{t("ui.hanzhi")}</span>
                <span className="text-[10px] font-bold text-brand-600 uppercase tracking-widest leading-none mt-1">DMD Companion</span>
            </div>
        )}
    </div>
  );
};