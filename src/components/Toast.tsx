import React, { useState } from 'react';
import { Upload, FileDown, Loader2 } from 'lucide-react';

interface ToastProps {
  message: string;
  type: 'success' | 'error' | 'info';
  onClose: () => void;
}

export function Toast({ message, type, onClose }: ToastProps) {
  React.useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const bgColors = {
    success: 'bg-[#0B0C10] border-[#66FCF1] text-[#66FCF1]',
    error: 'bg-[#0B0C10] border-red-500 text-red-500',
    info: 'bg-[#0B0C10] border-[#45A29E] text-[#45A29E]',
  };

  return (
    <div className={`fixed bottom-12 left-1/2 -translate-x-1/2 px-5 py-2 border rounded-full text-[11px] tracking-widest font-bold flex items-center gap-3 shadow-lg z-50 animate-in fade-in slide-in-from-bottom-5 ${bgColors[type]}`}>
      {type === 'info' && <Loader2 className="w-4 h-4 animate-spin" />}
      {type === 'success' && <FileDown className="w-4 h-4" />}
      <span className="uppercase">{message}</span>
    </div>
  );
}
