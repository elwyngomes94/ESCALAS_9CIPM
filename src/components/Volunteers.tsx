import React, { useState, useEffect } from 'react';
import { 
  collection, 
  getDocs, 
  getDoc,
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  query, 
  where,
  orderBy,
  serverTimestamp,
  writeBatch
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { Policeman, Volunteer } from '../types';
import { OperationType, handleFirestoreError, cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  X, 
  Save, 
  UserPlus,
  CreditCard,
  UserCheck,
  Users,
  Car,
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Check,
  AlertCircle,
  Download
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format, addMonths, subMonths, eachDayOfInterval, startOfMonth, endOfMonth, isSameDay, getDate, getDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface VolunteersProps {
  type: 'PJES' | 'OPS';
}

const Volunteers = ({ type }: VolunteersProps) => {
  const { isAdmin } = useAuth();
  const [volunteers, setVolunteers] = useState<(Volunteer & { policeman?: Policeman })[]>([]);
  const [policemen, setPolicemen] = useState<Policeman[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importSourceMonth, setImportSourceMonth] = useState(format(subMonths(new Date(), 1), 'yyyy-MM'));
  const [importing, setImporting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [polySearch, setPolySearch] = useState('');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  
  const [escalas, setEscalas] = useState<any[]>([]);
  
  const monthKey = format(currentDate, 'yyyy-MM');
  const monthName = format(currentDate, 'MMMM yyyy', { locale: ptBR });

  const [formData, setFormData] = useState<Omit<Volunteer, 'id'>>({
    policemanId: '',
    type: type,
    cotas: 1,
    month: monthKey,
    desiredService: ''
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const polySnap = await getDocs(query(collection(db, 'policemen'), orderBy('nomeGuerra')));
      const polyData = polySnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Policeman));
      setPolicemen(polyData);

      // Fetch Escalas for the month to calculate used cotas
      const escQ = query(collection(db, 'escalas'));
      const escSnap = await getDocs(escQ);
      const allEscalas = escSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      // Filter by date (YYYY-MM)
      const monthEscalas = allEscalas.filter(e => {
        const d = typeof e.date === 'string' ? e.date : e.date?.toDate?.().toISOString() || '';
        return d.startsWith(monthKey);
      });
      setEscalas(monthEscalas);

      const volQ = query(
        collection(db, 'volunteers'), 
        where('type', '==', type),
        where('month', '==', monthKey)
      );
      const volSnap = await getDocs(volQ);
      const volData = volSnap.docs.map(vDoc => {
        const v = { id: vDoc.id, ...vDoc.data() } as Volunteer;
        const p = polyData.find(police => police.id === v.policemanId);
        
        // Calculate scaled cotas for this type
        // Note: we need to know if the escala is PJES or OPS. 
        // We'll need to join with ServiceTypes too.
        return { ...v, policeman: p };
      });

      // To accurately calculate PJES/OPS scaled cotas, we need ServiceTypes
      const stSnap = await getDocs(collection(db, 'serviceTypes'));
      const serviceTypes = stSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

      const processedVols = volData.map(v => {
        const scaledCount = monthEscalas.filter(e => {
          const st = serviceTypes.find(t => t.id === e.serviceTypeId);
          return e.policemenIds.includes(v.policemanId) && st?.tipo === type;
        }).length;
        return { ...v, scaledCount };
      });

      setVolunteers(processedVols as any);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'volunteers');
    } finally {
      setLoading(false);
    }
  };

  const fetchOrdinarySchedule = async (policemanId: string) => {
    if (!policemanId) return;
    try {
      const docRef = doc(db, 'ordinarySchedules', `${policemanId}_${monthKey}`);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setSelectedDays(docSnap.data().days || []);
      } else {
        setSelectedDays([]);
      }
    } catch (err) {
      console.error("Error fetching schedule:", err);
    }
  };

  useEffect(() => {
    if (formData.policemanId && isModalOpen) {
      fetchOrdinarySchedule(formData.policemanId);
    }
  }, [formData.policemanId, monthKey, isModalOpen]);

  const handleImport = async () => {
    if (importing) return;
    if (importSourceMonth === monthKey) {
      alert("Selecione um mês de origem diferente do mês atual.");
      return;
    }

    setImporting(true);
    try {
      const prevVolQ = query(
        collection(db, 'volunteers'),
        where('type', '==', type),
        where('month', '==', importSourceMonth)
      );
      const prevVolSnap = await getDocs(prevVolQ);
      
      if (prevVolSnap.empty) {
        alert("Nenhum voluntário encontrado no mês de origem.");
        setImporting(false);
        return;
      }
      
      const { writeBatch } = await import('firebase/firestore');
      const batch = writeBatch(db);
      
      let importedCount = 0;
      
      // Also fetch ordinary schedules for source month to optionally copy them
      // Actually, standardizing on just the volunteer record for now as requested.
      
      for (const d of prevVolSnap.docs) {
        const data = d.data() as Volunteer;
        const alreadyExists = volunteers.some(v => v.policemanId === data.policemanId);
        
        if (!alreadyExists) {
            const newDocRef = doc(collection(db, 'volunteers'));
            batch.set(newDocRef, {
                policemanId: data.policemanId,
                type: data.type,
                cotas: data.cotas,
                desiredService: data.desiredService || '',
                month: monthKey,
                order: volunteers.length + importedCount,
                createdAt: serverTimestamp()
            });

            // Try to copy ordinary schedule too if it exists for the source month
            const oldScheduleRef = doc(db, 'ordinarySchedules', `${data.policemanId}_${importSourceMonth}`);
            const oldScheduleSnap = await getDoc(oldScheduleRef);
            if (oldScheduleSnap.exists()) {
                const newScheduleRef = doc(db, 'ordinarySchedules', `${data.policemanId}_${monthKey}`);
                batch.set(newScheduleRef, {
                    policemanId: data.policemanId,
                    month: monthKey,
                    days: oldScheduleSnap.data().days || [],
                    updatedAt: serverTimestamp()
                }, { merge: true });
            }

            importedCount++;
        }
      }
      
      if (importedCount > 0) {
        await batch.commit();
        alert(`${importedCount} voluntários importados com sucesso!`);
        setIsImportModalOpen(false);
        fetchData();
      } else {
        alert('Todos os voluntários do mês de origem já estão cadastrados no mês atual.');
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'volunteers_import');
    } finally {
      setImporting(false);
    }
  };

  const handleImportFromEfetivo = async () => {
    if (importing) return;
    if (!window.confirm(`Deseja importar TODO o efetivo ativo como voluntários ${type} para este mês?`)) return;

    setImporting(true);
    try {
      const activePolicemen = policemen.filter(p => p.situacao === 'Ativo');
      
      if (activePolicemen.length === 0) {
        alert("Nenhum policial ativo encontrado no efetivo.");
        setImporting(false);
        return;
      }
      
      const { writeBatch } = await import('firebase/firestore');
      const batch = writeBatch(db);
      
      let importedCount = 0;
      
      for (const p of activePolicemen) {
        const alreadyExists = volunteers.some(v => v.policemanId === p.id);
        
        if (!alreadyExists) {
            const newDocRef = doc(collection(db, 'volunteers'));
            batch.set(newDocRef, {
                policemanId: p.id,
                type: type,
                cotas: 10, // Padrão 10 cotas
                desiredService: '',
                month: monthKey,
                order: volunteers.length + importedCount,
                createdAt: serverTimestamp()
            });
            importedCount++;
        }
      }
      
      if (importedCount > 0) {
        await batch.commit();
        alert(`${importedCount} policiais importados do efetivo com sucesso!`);
        setIsImportModalOpen(false);
        fetchData();
      } else {
        alert('Todos os policiais ativos já estão cadastrados como voluntários neste mês.');
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'volunteers_efetivo_import');
    } finally {
      setImporting(false);
    }
  };

  useEffect(() => {
    fetchData();
    setFormData(prev => ({ ...prev, month: monthKey }));
  }, [type, monthKey]);

  const filteredVolunteers = volunteers.filter(v => 
    v.policeman?.nomeGuerra.toLowerCase().includes(searchTerm.toLowerCase()) ||
    v.policeman?.nomeCompleto.toLowerCase().includes(searchTerm.toLowerCase()) ||
    v.policeman?.matricula.includes(searchTerm)
  );

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.policemanId) {
      alert('Por favor, selecione um policial.');
      return;
    }
    if (formData.cotas > 12) {
      alert('O limite máximo é de 12 cotas.');
      return;
    }
    
    const exists = volunteers.find(v => v.policemanId === formData.policemanId && v.id !== editingId);
    if (exists) {
        alert('Este policial já está cadastrado como voluntário para esta modalidade.');
        return;
    }

    try {
      const batch = writeBatch(db);

      // Volunteer record
      if (editingId) {
        batch.update(doc(db, 'volunteers', editingId), {
          ...formData,
          updatedAt: serverTimestamp()
        });
      } else {
        const newVolRef = doc(collection(db, 'volunteers'));
        batch.set(newVolRef, {
          ...formData,
          order: volunteers.length,
          createdAt: serverTimestamp()
        });
      }

      // Ordinary Schedule record
      const scheduleId = `${formData.policemanId}_${monthKey}`;
      const scheduleRef = doc(db, 'ordinarySchedules', scheduleId);
      batch.set(scheduleRef, {
        policemanId: formData.policemanId,
        month: monthKey,
        days: selectedDays,
        updatedAt: serverTimestamp()
      }, { merge: true });

      await batch.commit();

      setIsModalOpen(false);
      setEditingId(null);
      setFormData({
        policemanId: '',
        type: type,
        cotas: 1,
        month: monthKey
      });
      setSelectedDays([]);
      fetchData();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'volunteers');
    }
  };

  const handleEdit = (v: Volunteer) => {
    setEditingId(v.id!);
    setPolySearch('');
    setFormData({
      policemanId: v.policemanId,
      type: v.type,
      cotas: v.cotas,
      month: v.month,
      desiredService: v.desiredService || ''
    });
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Remover este voluntário?')) return;
    try {
      await deleteDoc(doc(db, 'volunteers', id));
      // Optimistic update
      setVolunteers(prev => prev.filter(v => v.id !== id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'volunteers');
    }
  };

  const totalCotas = volunteers.reduce((acc, v) => acc + (v.cotas || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-800 uppercase tracking-tighter">Voluntários {type}</h2>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Status de voluntariado e cotas mensais</p>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-sm">
            <button 
              onClick={() => setCurrentDate(prev => subMonths(prev, 1))}
              className="p-1.5 hover:bg-slate-100 rounded-lg transition-all text-slate-400 hover:text-pmpe-navy"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 min-w-[120px] justify-center">
              <CalendarIcon className="w-3.5 h-3.5 text-pmpe-gold" />
              <span className="text-[11px] font-black uppercase text-pmpe-navy truncate capitalize">
                {monthName}
              </span>
            </div>
            <button 
              onClick={() => setCurrentDate(prev => addMonths(prev, 1))}
              className="p-1.5 hover:bg-slate-100 rounded-lg transition-all text-slate-400 hover:text-pmpe-navy"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {isAdmin && (
            <div className="flex gap-2">
              <button
                onClick={() => setIsImportModalOpen(true)}
                className="bg-white text-pmpe-navy border border-pmpe-navy/20 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest flex items-center gap-2 hover:bg-slate-50 transition-all shadow-sm shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                Importar
              </button>
              <button
                onClick={() => setIsModalOpen(true)}
                className="bg-pmpe-navy text-white px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest flex items-center gap-2 hover:bg-slate-800 transition-all shadow-sm shrink-0"
              >
                <Plus className="w-3.5 h-3.5 text-pmpe-gold" />
                Adicionar
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-blue-50">
            <Users className="w-4 h-4 text-blue-600" />
          </div>
          <div>
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider leading-none mb-1">Total Voluntários</p>
            <p className="text-lg font-black text-slate-800 leading-none">{volunteers.length}</p>
          </div>
        </div>
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-amber-50">
            <CreditCard className="w-4 h-4 text-amber-600" />
          </div>
          <div>
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider leading-none mb-1">Cotas Alocadas</p>
            <p className="text-lg font-black text-slate-800 leading-none">{totalCotas}</p>
          </div>
        </div>
      </div>

      <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Pesquisar por nome ou matrícula..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-pmpe-navy/10 transition-all font-bold"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white p-4 rounded-xl border border-slate-200 animate-pulse h-24" />
          ))
        ) : filteredVolunteers.length === 0 ? (
          <div className="col-span-full py-12 text-center text-xs text-slate-400 font-bold uppercase italic bg-white rounded-xl border border-dashed border-slate-200">
            {searchTerm ? 'Nenhum voluntário encontrado para a busca.' : `Nenhum voluntário ${type} cadastrado.`}
          </div>
        ) : (
          filteredVolunteers.map((v: any, idx) => {
            const remaining = v.cotas - (v.scaledCount || 0);
            return (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: idx * 0.05 }}
                key={v.id}
                className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 relative group transition-all hover:shadow-md"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded bg-slate-100 flex items-center justify-center text-[11px] font-black text-slate-500 group-hover:bg-pmpe-navy group-hover:text-white transition-colors">
                    {v.policeman?.nomeGuerra.substring(0, 2).toUpperCase() || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-slate-800 text-[13px] leading-none mb-1 truncate">{v.policeman?.nomeGuerra || 'Policial Removido'}</h3>
                    <p className="text-[10px] text-slate-400 uppercase font-bold tracking-tight">{v.policeman?.graduacaoPosto} • {v.policeman?.matricula}</p>
                  </div>
                </div>

                  <div className="mt-4 space-y-2">
                    <div className="p-2 bg-slate-50 rounded border border-slate-100">
                      <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Dias Disponíveis</p>
                      <div className="flex flex-wrap gap-1">
                        {Array.from({ length: endOfMonth(currentDate).getDate() }, (_, i) => i + 1).map(d => {
                            const isOrdinary = selectedDays.includes(d); // This might be wrong logic here, wait.
                            // The card doesn't know the ordinary schedule unless we fetch it for every PM.
                            // I should probably skip full display and just show "Ver calendário" or count.
                            return null;
                        })}
                        <span className="text-[9px] font-bold text-pmpe-navy">Conforme Escala Ordinária</span>
                      </div>
                    </div>

                    {v.desiredService && (
                      <div className="p-2 bg-pmpe-gold/10 rounded border border-pmpe-gold/20">
                        <p className="text-[8px] font-black text-pmpe-gold uppercase tracking-widest mb-0.5">Serviço Desejado</p>
                        <p className="text-[10px] font-black text-pmpe-navy uppercase truncate">{v.desiredService}</p>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <div className="p-2 bg-slate-50 rounded border border-slate-100 flex flex-col justify-center">
                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Solicitadas</p>
                        <div className="flex items-center gap-1.5">
                          <CreditCard className="w-3 h-3 text-slate-400" />
                          <span className="text-xs font-black text-slate-700">{v.cotas}</span>
                        </div>
                      </div>
                      <div className="p-2 bg-slate-50 rounded border border-slate-100 flex flex-col justify-center">
                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Escaladas</p>
                        <div className="flex items-center gap-1.5">
                          <Check className="w-3 h-3 text-green-500" />
                          <span className="text-xs font-black text-slate-700">{v.scaledCount || 0}</span>
                        </div>
                      </div>
                    </div>

                  <div className={cn(
                    "p-2 rounded border flex items-center justify-between transition-all",
                    remaining > 0 ? "bg-blue-50 border-blue-100" : "bg-slate-50 border-slate-100"
                  )}>
                    <p className="text-[9px] font-black text-blue-600 uppercase tracking-widest">Restantes</p>
                    <span className={cn(
                      "text-sm font-black",
                      remaining > 0 ? "text-pmpe-navy" : "text-slate-400"
                    )}>{remaining}</span>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <div className={cn(
                      "w-2 h-2 rounded-full",
                      remaining > 0 ? "bg-green-500 animate-pulse" : "bg-slate-300"
                    )} />
                    <span className="text-[9px] font-black text-slate-500 uppercase tracking-tight">
                      {remaining > 0 ? 'Disponível' : 'Cota Esgotada'}
                    </span>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                      <button
                        onClick={() => handleEdit(v)}
                        className="p-1.5 text-slate-300 hover:text-blue-500 hover:bg-blue-50 rounded transition-all"
                        title="Editar Voluntário"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(v.id!)}
                        className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded transition-all"
                        title="Remover Voluntário"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                <div className="absolute -top-1.5 -right-1.5">
                    <span className={cn(
                      "px-2 py-0.5 rounded shadow-sm text-[8px] font-black uppercase tracking-widest text-white border border-white/20",
                      type === 'PJES' ? "bg-pmpe-navy" : "bg-pmpe-gold text-pmpe-navy"
                    )}>
                      {type}
                    </span>
                </div>
              </motion.div>
            );
          })
        )}
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-pmpe-navy/40 backdrop-blur-sm"
              onClick={() => setIsModalOpen(false)}
            />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl relative z-[110] overflow-hidden border border-slate-200"
              >
                <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                  <h3 className="text-sm font-black text-slate-800 uppercase tracking-tighter">
                    {editingId ? `Editar Voluntário ${type}` : `Adicionar Voluntário ${type}`}
                  </h3>
                  <button 
                    onClick={() => {
                        setIsModalOpen(false);
                        setEditingId(null);
                        setFormData({
                          policemanId: '',
                          type: type,
                          cotas: 1,
                          month: monthKey
                        });
                        setSelectedDays([]);
                    }}
                    className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <form onSubmit={handleSave} className="flex flex-col md:flex-row h-[600px] md:h-auto">
                    {/* Left Side: Volunteer Data */}
                    <div className="p-6 space-y-6 flex-1 border-r border-slate-100 overflow-y-auto">
                        <div>
                          <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Selecionar Policial</label>
                          
                          <div className="space-y-2">
                            <div className="relative">
                              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                              <input
                                type="text"
                                placeholder="Pesquisar policial..."
                                value={polySearch}
                                onChange={(e) => setPolySearch(e.target.value)}
                                className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-pmpe-navy/10 transition-all font-bold"
                              />
                            </div>
                            
                            <div className="max-h-[160px] overflow-y-auto border border-slate-100 rounded-lg divide-y divide-slate-50 bg-white shadow-inner">
                              {policemen
                                .filter(p => 
                                  p.nomeGuerra.toLowerCase().includes(polySearch.toLowerCase()) ||
                                  p.nomeCompleto.toLowerCase().includes(polySearch.toLowerCase()) ||
                                  p.matricula.includes(polySearch)
                                )
                                .map(p => (
                                  <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => {
                                      setFormData({ ...formData, policemanId: p.id! });
                                      setPolySearch('');
                                    }}
                                    className={cn(
                                      "w-full px-3 py-2 text-left flex items-center justify-between hover:bg-slate-50 transition-colors group",
                                      formData.policemanId === p.id ? "bg-pmpe-navy/5 border-l-2 border-pmpe-navy" : ""
                                    )}
                                  >
                                    <div className="flex-1 min-w-0">
                                      <p className={cn(
                                        "text-[10px] font-black uppercase leading-tight",
                                        formData.policemanId === p.id ? "text-pmpe-navy" : "text-slate-700"
                                      )}>
                                        {p.graduacaoPosto} {p.nomeGuerra}
                                      </p>
                                      <p className="text-[8px] text-slate-400 font-bold uppercase tracking-tighter font-mono">Mat: {p.matricula}</p>
                                    </div>
                                    
                                    {formData.policemanId === p.id && (
                                      <UserCheck className="w-3.5 h-3.5 text-pmpe-navy" />
                                    )}
                                  </button>
                                ))}
                            </div>
                          </div>
                        </div>

                        <div>
                          <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Serviço Desejado (Opcional)</label>
                          <input 
                            type="text"
                            value={formData.desiredService}
                            onChange={(e) => setFormData({ ...formData, desiredService: e.target.value })}
                            placeholder="Ex: Patrulha Escolar, GATI, etc."
                            className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-pmpe-navy/10 transition-all font-bold"
                          />
                        </div>

                        <div>
                          <div className="flex justify-between items-center mb-2">
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                              Quantidade de Cotas
                            </label>
                            <span className="text-xs font-black text-pmpe-navy bg-slate-100 px-2 py-0.5 rounded border border-slate-200">{formData.cotas}</span>
                          </div>
                          <input
                            type="range"
                            min="1"
                            max="12"
                            value={formData.cotas}
                            onChange={(e) => setFormData({...formData, cotas: parseInt(e.target.value)})}
                            className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-pmpe-navy border border-slate-200"
                          />
                          <p className="text-[9px] text-slate-400 mt-2 font-bold uppercase tracking-tight leading-relaxed italic">
                            * O policial pode ter até 12 cotas de {type} por mês.
                          </p>
                        </div>
                    </div>

                    {/* Right Side: Ordinary Schedule Calendar */}
                    <div className="p-6 flex-1 bg-slate-50/50">
                        <div className="flex flex-col h-full">
                            <div className="mb-4">
                                <div className="flex items-center gap-2 mb-1">
                                    <CalendarIcon className="w-4 h-4 text-pmpe-navy" />
                                    <h4 className="text-[11px] font-black text-slate-800 uppercase tracking-tight">Escala Ordinária (Restrições)</h4>
                                </div>
                                <p className="text-[10px] font-medium text-slate-500 leading-tight">Selecione os dias que este policial já possui serviço ordinário para evitar choques de escala.</p>
                            </div>

                            <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm flex-1">
                                <div className="grid grid-cols-7 gap-1 mb-2">
                                    {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => (
                                        <div key={i} className="text-center text-[9px] font-black text-slate-300 uppercase">{d}</div>
                                    ))}
                                </div>
                                <div className="grid grid-cols-7 gap-1">
                                    {/* Padding for start of month */}
                                    {Array.from({ length: getDay(startOfMonth(currentDate)) }).map((_, i) => (
                                        <div key={`pad-${i}`} className="h-8" />
                                    ))}
                                    {eachDayOfInterval({
                                        start: startOfMonth(currentDate),
                                        end: endOfMonth(currentDate)
                                    }).map(day => {
                                        const d = getDate(day);
                                        const isSelected = selectedDays.includes(d);
                                        return (
                                            <button
                                                key={day.toISOString()}
                                                type="button"
                                                onClick={() => {
                                                    if (isSelected) {
                                                        setSelectedDays(prev => prev.filter(dayNum => dayNum !== d));
                                                    } else {
                                                        setSelectedDays(prev => [...prev, d]);
                                                    }
                                                }}
                                                className={cn(
                                                    "h-8 rounded-lg text-[10px] font-black transition-all flex items-center justify-center relative",
                                                    isSelected 
                                                        ? "bg-pmpe-navy text-white shadow-md scale-105 z-10" 
                                                        : "hover:bg-slate-100 text-slate-600"
                                                )}
                                            >
                                                {d}
                                                {isSelected && (
                                                    <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-pmpe-gold rounded-full border-2 border-white" />
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="mt-4 flex items-start gap-2 p-2 bg-blue-50 rounded-lg border border-blue-100">
                                <AlertCircle className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" />
                                <p className="text-[9px] text-blue-700 font-bold uppercase tracking-tight leading-normal">
                                    Os dias marcados ficarão bloqueados para alocação automática deste policial.
                                </p>
                            </div>
                        </div>
                    </div>
                </form>

                <div className="p-4 bg-white border-t border-slate-100 flex justify-end gap-3 px-6">
                  <button
                    type="button"
                    onClick={() => {
                        setIsModalOpen(false);
                        setEditingId(null);
                        setFormData({
                          policemanId: '',
                          type: type,
                          cotas: 1,
                          month: monthKey
                        });
                        setSelectedDays([]);
                    }}
                    className="px-6 py-2 rounded-lg text-xs font-bold uppercase tracking-widest text-slate-500 hover:bg-slate-100 transition-all font-sans"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleSave}
                    className="px-8 py-2 bg-pmpe-navy text-white rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-slate-800 transition-all shadow-md flex items-center gap-2 font-sans"
                  >
                    <Save className="w-3.5 h-3.5 text-pmpe-gold" />
                    <span>Confirmar Voluntariado</span>
                  </button>
                </div>
              </motion.div>
          </div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {isImportModalOpen && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsImportModalOpen(false)}
              className="absolute inset-0 bg-pmpe-navy/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200"
            >
              <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2">
                  <Download className="w-4 h-4 text-pmpe-gold" />
                  Opções de Importação {type}
                </h3>
                <button 
                  onClick={() => setIsImportModalOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-6">
                {/* Monthly Import Section */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <CalendarIcon className="w-4 h-4 text-pmpe-navy" />
                    <h4 className="text-[11px] font-black text-slate-800 uppercase tracking-tight">Importar de Mês Anterior</h4>
                  </div>
                  
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-relaxed">
                    Copia a lista de voluntários de um mês anterior para o mês atual ({monthName}). <br/>
                    <span className="text-amber-600 font-black">* Também serão copiadas as escalas ordinárias (dias indisponíveis) dos policiais.</span>
                  </p>

                  <div className="space-y-4 pt-2">
                    <div>
                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Mês de Origem (Copiar de)</label>
                        <input
                          type="month"
                          value={importSourceMonth}
                          onChange={(e) => setImportSourceMonth(e.target.value)}
                          className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pmpe-navy/5 transition-all font-bold"
                        />
                    </div>
                    
                    <button
                      onClick={handleImport}
                      disabled={importing}
                      className="w-full px-6 py-2.5 bg-white text-pmpe-navy border border-pmpe-navy/20 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 transition-all shadow-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed font-sans"
                    >
                      {importing ? (
                        <div className="w-3.5 h-3.5 border-2 border-pmpe-navy border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                      )}
                      <span>{importing ? 'Importando...' : 'Importar deste Mês'}</span>
                    </button>
                  </div>
                </div>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-slate-100"></span>
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-white px-2 text-[9px] font-black text-slate-300 tracking-widest">OU</span>
                  </div>
                </div>

                {/* Efetivo Import Section */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-pmpe-navy" />
                    <h4 className="text-[11px] font-black text-slate-800 uppercase tracking-tight">Importar TODO Efetivo Ativo</h4>
                  </div>
                  
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-relaxed">
                    Adiciona todos os policiais marcados como "Ativo" no registro geral como voluntários para {monthName}.
                  </p>

                  <button
                    onClick={handleImportFromEfetivo}
                    disabled={importing}
                    className="w-full px-6 py-2.5 bg-pmpe-navy text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed font-sans"
                  >
                    {importing ? (
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Plus className="w-3.5 h-3.5 text-pmpe-gold" />
                    )}
                    <span>{importing ? 'Processando...' : `Importar Efetivo p/ ${type}`}</span>
                  </button>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setIsImportModalOpen(false)}
                    className="px-6 py-2 rounded-lg text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-all font-sans"
                  >
                    Fechar
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Volunteers;
