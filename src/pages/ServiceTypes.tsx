import React, { useState, useEffect } from 'react';
import { 
  collection, 
  getDocs, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  query, 
  orderBy,
  serverTimestamp
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { ServiceType } from '../types';
import { OperationType, handleFirestoreError, cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  X, 
  Save, 
  Briefcase,
  MapPin,
  Clock,
  Info,
  Calendar as CalendarIcon,
  Users
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, parseISO, getDate } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const ServiceTypes = () => {
  const { isAdmin } = useAuth();
  const [services, setServices] = useState<ServiceType[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const [formData, setFormData] = useState<Omit<ServiceType, 'id'>>({
    nome: '',
    tipo: 'PJES',
    cidade: '',
    horarioInicio: '',
    horarioTermino: '',
    diasOperacao: [],
    activeDates: [],
    month: format(new Date(), 'yyyy-MM'),
    observacoes: '',
    color: '#003366',
    categoria: 'PATRULHA',
    sigla: 'PTR',
    vagasNecessarias: 2,
    cotasPorEscala: 1,
    isActive: true
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'serviceTypes'), orderBy('nome'));
      const snap = await getDocs(q);
      const data = snap.docs.map(doc => {
        const d = doc.data();
        return { 
          id: doc.id, 
          ...d,
          activeDates: d.activeDates || [],
          month: d.month || format(new Date(), 'yyyy-MM'),
          cotasPorEscala: d.cotasPorEscala ?? 1,
          isActive: d.isActive ?? true
        } as ServiceType;
      });
      setServices(data);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'serviceTypes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        await updateDoc(doc(db, 'serviceTypes', editingId), {
          ...formData,
          activeDates: formData.activeDates || [],
          updatedAt: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, 'serviceTypes'), {
          ...formData,
          activeDates: formData.activeDates || [],
          createdAt: serverTimestamp()
        });
      }
      setIsModalOpen(false);
      setEditingId(null);
      setFormData({
        nome: '',
        tipo: 'PJES',
        cidade: '',
        horarioInicio: '',
        horarioTermino: '',
        diasOperacao: [],
        activeDates: [],
        month: format(new Date(), 'yyyy-MM'),
        observacoes: '',
        color: '#003366',
        categoria: 'PATRULHA',
        sigla: 'PTR',
        vagasNecessarias: 2,
        cotasPorEscala: 1,
        isActive: true
      });
      fetchData();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'serviceTypes');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Deseja realmente excluir este tipo de serviço?')) return;
    try {
      await deleteDoc(doc(db, 'serviceTypes', id));
      // Optimistic update
      setServices(prev => prev.filter(s => s.id !== id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'serviceTypes');
    }
  };

  const openEditor = (s?: ServiceType) => {
    if (s) {
      setEditingId(s.id!);
      setFormData({
        nome: s.nome,
        tipo: s.tipo,
        cidade: s.cidade,
        horarioInicio: s.horarioInicio,
        horarioTermino: s.horarioTermino,
        diasOperacao: s.diasOperacao || [],
        activeDates: s.activeDates || [],
        month: s.month || format(new Date(), 'yyyy-MM'),
        observacoes: s.observacoes || '',
        color: s.color || '#003366',
        categoria: s.categoria || 'PATRULHA',
        sigla: s.sigla || 'PTR',
        vagasNecessarias: s.vagasNecessarias || 2,
        cotasPorEscala: s.cotasPorEscala ?? 1,
        isActive: s.isActive ?? true
      });
    } else {
      setEditingId(null);
      setFormData({
        nome: '',
        tipo: 'PJES',
        cidade: '',
        horarioInicio: '',
        horarioTermino: '',
        diasOperacao: [],
        activeDates: [],
        month: format(new Date(), 'yyyy-MM'),
        observacoes: '',
        color: '#003366',
        categoria: 'PATRULHA',
        sigla: 'PTR',
        vagasNecessarias: 2,
        cotasPorEscala: 1,
        isActive: true
      });
    }
    setIsModalOpen(true);
  };

  const toggleActiveDate = (dateStr: string) => {
    const current = formData.activeDates || [];
    if (current.includes(dateStr)) {
      setFormData({ ...formData, activeDates: current.filter(d => d !== dateStr) });
    } else {
      setFormData({ ...formData, activeDates: [...current, dateStr].sort() });
    }
  };

  const filtered = services.filter(s => 
    s.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.cidade.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-800 uppercase tracking-tighter">Tipos de Serviço</h2>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Configuração das modalidades operacionais</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => openEditor()}
            className="bg-pmpe-navy text-white px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest flex items-center gap-2 hover:bg-slate-800 transition-all shadow-sm"
          >
            <Plus className="w-3.5 h-3.5 text-pmpe-gold" />
            Novo Modalidade
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 bg-slate-50/50">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Pesquise por serviço ou cidade..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-pmpe-navy/5 focus:border-pmpe-navy transition-all"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="px-6 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest">Modalidade</th>
                <th className="px-6 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest text-center">Tipo</th>
                <th className="px-6 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest">Cidade</th>
                <th className="px-6 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest text-center">Cotas</th>
                <th className="px-6 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest text-center">Status</th>
                <th className="px-6 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest">Dias Operação</th>
                <th className="px-6 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest">Carga Horária</th>
                {isAdmin && <th className="px-6 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest text-right">Ações</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={isAdmin ? 5 : 4} className="px-6 py-8 text-center text-xs text-slate-400 font-bold uppercase italic">Buscando modalidades...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={isAdmin ? 5 : 4} className="px-6 py-8 text-center text-xs text-slate-400 font-bold uppercase italic">Nenhum serviço registrado</td></tr>
              ) : filtered.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/80 transition-colors group">
                  <td className="px-6 py-4">
                    <p className="font-bold text-slate-800 text-[13px] leading-tight mb-0.5">{s.nome}</p>
                    {s.observacoes && <p className="text-[10px] text-slate-400 uppercase font-bold tracking-tight line-clamp-1">{s.observacoes}</p>}
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className={cn(
                      "px-2.5 py-0.5 rounded text-[9px] font-black tracking-widest uppercase border",
                      s.tipo === 'PJES' ? "bg-pmpe-navy text-white border-pmpe-navy" : "bg-pmpe-gold text-pmpe-navy border-pmpe-gold/20"
                    )}>
                      {s.tipo}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1.5 text-slate-600">
                      <MapPin className="w-3 h-3 text-slate-400" />
                      <span className="text-[11px] font-bold uppercase tracking-tight">{s.cidade}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="text-[11px] font-black text-pmpe-navy bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                      {s.cotasPorEscala}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className={cn(
                      "text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded border",
                      s.isActive ? "bg-green-50 text-green-600 border-green-100" : "bg-red-50 text-red-600 border-red-100"
                    )}>
                      {s.isActive ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-0.5 max-w-[120px]">
                      {s.diasOperacao?.length ? s.diasOperacao.map(d => (
                        <span key={d} className="w-5 h-5 flex items-center justify-center bg-slate-100 text-[9px] font-black text-slate-400 rounded border border-slate-200">{d}</span>
                      )) : <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest italic">Diário</span>}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1.5 text-slate-800">
                      <Clock className="w-3 h-3 text-slate-400" />
                      <span className="text-[11px] font-black font-mono">{s.horarioInicio} - {s.horarioTermino}</span>
                    </div>
                  </td>
                  {isAdmin && (
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => openEditor(s)}
                          className="p-1.5 text-slate-400 hover:text-pmpe-navy hover:bg-slate-100 rounded transition-all"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(s.id!)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-all"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-pmpe-navy/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200"
            >
              <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-tighter">
                  {editingId ? 'Editar Modalidade' : 'Nova Modalidade'}
                </h3>
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSave} className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Nome do Serviço</label>
                    <input
                      type="text"
                      required
                      placeholder="Ex: Policiamento Ostensivo"
                      value={formData.nome}
                      onChange={(e) => setFormData({...formData, nome: e.target.value})}
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pmpe-navy/5 focus:border-pmpe-navy transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Tipo</label>
                    <select
                      required
                      value={formData.tipo}
                      onChange={(e) => setFormData({...formData, tipo: e.target.value as 'PJES' | 'OPS'})}
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pmpe-navy/5 focus:border-pmpe-navy transition-all appearance-none"
                    >
                      <option value="PJES">PJES</option>
                      <option value="OPS">OPS</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Cidade</label>
                    <input
                      type="text"
                      required
                      placeholder="Araripina..."
                      value={formData.cidade}
                      onChange={(e) => setFormData({...formData, cidade: e.target.value})}
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pmpe-navy/5 focus:border-pmpe-navy transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Cor no Calendário</label>
                    <input
                      type="color"
                      value={formData.color}
                      onChange={(e) => setFormData({...formData, color: e.target.value})}
                      className="w-full h-9 px-1 py-1 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Sigla (Max 4 letras)</label>
                    <input
                      type="text"
                      maxLength={4}
                      value={formData.sigla}
                      onChange={(e) => setFormData({...formData, sigla: e.target.value.toUpperCase()})}
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pmpe-navy/5 focus:border-pmpe-navy transition-all"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Categoria de Serviço</label>
                    <select
                      required
                      value={formData.categoria}
                      onChange={(e) => setFormData({...formData, categoria: e.target.value as any})}
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pmpe-navy/5 focus:border-pmpe-navy transition-all appearance-none"
                    >
                      {['ORDINÁRIO', 'PJES', 'OPS', 'PATRULHA', 'GGI', 'GUARDA', 'OPERAÇÃO', 'EXTRA', 'APOIO', 'SUPERVISÃO', 'TÁTICO'].map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Início</label>
                    <input
                      type="time"
                      required
                      value={formData.horarioInicio}
                      onChange={(e) => setFormData({...formData, horarioInicio: e.target.value})}
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pmpe-navy/5 focus:border-pmpe-navy transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Término</label>
                    <input
                      type="time"
                      required
                      value={formData.horarioTermino}
                      onChange={(e) => setFormData({...formData, horarioTermino: e.target.value})}
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pmpe-navy/5 focus:border-pmpe-navy transition-all"
                    />
                  </div>
                  <div className="col-span-2 grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Mês de Referência</label>
                      <input
                        type="month"
                        required
                        value={formData.month}
                        onChange={(e) => setFormData({...formData, month: e.target.value})}
                        className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pmpe-navy/5 focus:border-pmpe-navy transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Vagas Necessárias</label>
                      <input
                        type="number"
                        min={1}
                        required
                        value={formData.vagasNecessarias}
                        onChange={(e) => setFormData({...formData, vagasNecessarias: parseInt(e.target.value)})}
                        className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pmpe-navy/5 focus:border-pmpe-navy transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Cotas Consumidas (por PM)</label>
                      <input
                        type="number"
                        min={1}
                        required
                        value={formData.cotasPorEscala}
                        onChange={(e) => setFormData({...formData, cotasPorEscala: parseInt(e.target.value)})}
                        className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pmpe-navy/5 focus:border-pmpe-navy transition-all"
                      />
                    </div>
                    <div className="col-span-2">
                       <label className="flex items-center gap-2 cursor-pointer group bg-slate-50 p-3 rounded-lg border border-slate-200 hover:border-pmpe-navy transition-all">
                          <input
                            type="checkbox"
                            checked={formData.isActive}
                            onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                            className="w-4 h-4 rounded border-slate-300 text-pmpe-navy focus:ring-pmpe-navy"
                          />
                          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Modalidade Ativa para Novas Escalas</span>
                       </label>
                    </div>
                  </div>

                  <div className="col-span-2">
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                      Dias Ativos em {format(parseISO(formData.month + '-01'), 'MMMM/yyyy', { locale: ptBR })}
                    </label>
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
                      <div className="grid grid-cols-7 gap-1">
                        {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => (
                           <div key={i} className="text-center text-[9px] font-black text-slate-300 py-1">{d}</div>
                        ))}
                        {(() => {
                           const start = startOfMonth(parseISO(formData.month + '-01'));
                           const end = endOfMonth(start);
                           const days = eachDayOfInterval({ start, end });
                           const firstDayIdx = start.getDay();
                           
                           return (
                             <>
                               {Array.from({ length: firstDayIdx }).map((_, i) => <div key={`empty-${i}`} />)}
                               {days.map(date => {
                                 const dateStr = format(date, 'yyyy-MM-dd');
                                 const isActive = formData.activeDates?.includes(dateStr);
                                 return (
                                   <button
                                     key={dateStr}
                                     type="button"
                                     onClick={() => toggleActiveDate(dateStr)}
                                     className={cn(
                                       "h-8 flex flex-col items-center justify-center rounded-lg text-[10px] font-black transition-all border",
                                       isActive 
                                         ? "bg-pmpe-navy text-white border-pmpe-navy shadow-md" 
                                         : "bg-white text-slate-400 border-slate-200 hover:border-pmpe-navy/30"
                                     )}
                                   >
                                     {getDate(date)}
                                   </button>
                                 );
                               })}
                             </>
                           );
                        })()}
                      </div>
                    </div>
                    <p className="text-[9px] font-bold text-slate-400 mt-2 uppercase tracking-tight italic">
                       * Clique nos dias para ativar este serviço no calendário de escalas.
                    </p>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Observações</label>
                    <textarea
                      rows={2}
                      value={formData.observacoes}
                      onChange={(e) => setFormData({...formData, observacoes: e.target.value})}
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pmpe-navy/5 focus:border-pmpe-navy transition-all resize-none"
                    />
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-100 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-6 py-2 rounded-lg text-xs font-bold uppercase tracking-widest text-slate-500 hover:bg-slate-100 transition-all"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2 bg-pmpe-navy text-white rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-slate-800 transition-all shadow-sm flex items-center gap-2"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Salvar Modalidade</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ServiceTypes;
