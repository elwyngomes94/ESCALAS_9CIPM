import React, { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { motion } from 'motion/react';
import { Users, Briefcase, ClipboardList, UserCheck, CreditCard, Shield } from 'lucide-react';
import { cn } from '../lib/utils';

const Dashboard = () => {
  const [stats, setStats] = useState({
    policemen: 0,
    services: 0,
    escalas: 0,
    volunteers: 0,
    cotas: 0
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const polySnap = await getDocs(collection(db, 'policemen'));
        const servSnap = await getDocs(collection(db, 'serviceTypes'));
        const escSnap = await getDocs(collection(db, 'escalas'));
        const volSnap = await getDocs(collection(db, 'volunteers'));

        let totalCotas = 0;
        volSnap.forEach(doc => {
          totalCotas += doc.data().cotas || 0;
        });

        setStats({
          policemen: polySnap.size,
          services: servSnap.size,
          escalas: escSnap.size,
          volunteers: volSnap.size,
          cotas: totalCotas
        });
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const cards = [
    { label: "Policiais", value: stats.policemen, icon: Users, color: "bg-blue-600", progress: "w-full" },
    { label: "Serviços", value: stats.services, icon: Briefcase, color: "bg-red-500", progress: "w-3/4" },
    { label: "Escalas", value: stats.escalas, icon: ClipboardList, color: "bg-green-500", progress: "w-1/2" },
    { label: "Voluntários", value: stats.volunteers, icon: UserCheck, color: "bg-amber-500", progress: "w-2/3" },
    { label: "Total de Cotas", value: stats.cotas, icon: CreditCard, color: "bg-purple-600", progress: "w-4/5" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {cards.map((card, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05 }}
            className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm"
          >
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">{card.label}</p>
            <p className="text-2xl font-black text-slate-800">
              {loading ? "..." : card.value.toLocaleString()}
            </p>
            <div className="mt-2 w-full h-1 bg-slate-100 rounded-full overflow-hidden">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: card.progress.replace('w-', '') }}
                className={cn("h-full", card.color)} 
              />
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col h-[400px]">
          <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <h3 className="text-xs font-bold uppercase text-slate-500 tracking-tight flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-pmpe-navy" />
              Informativo da Unidade
            </h3>
          </div>
          <div className="p-8 space-y-4 text-slate-600 leading-relaxed text-sm flex-1">
             <p>Este sistema é o canal oficial para gerenciamento do efetivo voluntário da 9ª CIPM em escalas extras.</p>
             <div className="grid grid-cols-2 gap-4 mt-6">
               <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
                 <h4 className="text-[10px] font-bold text-pmpe-navy uppercase mb-2">Orientações PJES</h4>
                 <p className="text-[11px] leading-tight">O limite de 12 cotas é mensal e improrrogável. Verifique sua situação de pecúlio antes de se voluntariar.</p>
               </div>
               <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
                 <h4 className="text-[10px] font-bold text-pmpe-red uppercase mb-2">Urgência OPS</h4>
                 <p className="text-[11px] leading-tight">Serviços OPS demandam mobilização rápida. Mantenha seu telefone atualizado no cadastro de pecúlio.</p>
               </div>
             </div>
             <p className="text-xs text-slate-400 italic mt-8 border-t border-slate-50 pt-4">
               "A segurança é um dever do Estado, direito e responsabilidade de todos."
             </p>
          </div>
        </div>
        
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col">
            <div className="flex-1 flex flex-col items-center justify-center space-y-6 opacity-30 hover:opacity-100 transition-opacity duration-500">
              <img 
                 src="https://upload.wikimedia.org/wikipedia/commons/e/e0/Bras%C3%A3o_da_Pol%C3%ADcia_Militar_de_Pernambuco.png" 
                 alt="Logo" 
                 className="h-40 object-contain grayscale" 
              />
              <div className="text-center">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">PMPE - 9ª CIPM</p>
                <p className="text-[9px] text-slate-300 font-bold uppercase mt-1">Araripina • Pernambuco</p>
              </div>
            </div>
            
            <div className="mt-auto p-4 bg-blue-50 border border-blue-100 rounded-lg">
              <p className="text-[10px] font-bold text-blue-800 uppercase mb-1">Status Operacional</p>
              <p className="text-[11px] text-blue-600 leading-tight">O sistema está processando as escalas para o próximo fim de semana.</p>
            </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
