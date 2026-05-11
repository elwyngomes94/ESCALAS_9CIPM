import React, { useState, useEffect } from 'react';
import { 
  collection, 
  getDocs, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  query, 
  where,
  orderBy,
  serverTimestamp
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
  Car
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [polySearch, setPolySearch] = useState('');
  
  const [formData, setFormData] = useState<Omit<Volunteer, 'id'>>({
    policemanId: '',
    type: type,
    cotas: 1
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const polySnap = await getDocs(query(collection(db, 'policemen'), orderBy('nomeGuerra')));
      const polyData = polySnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Policeman));
      setPolicemen(polyData);

      const volQ = query(collection(db, 'volunteers'), where('type', '==', type));
      const volSnap = await getDocs(volQ);
      const volData = volSnap.docs.map(vDoc => {
        const v = { id: vDoc.id, ...vDoc.data() } as Volunteer;
        const p = polyData.find(police => police.id === v.policemanId);
        return { ...v, policeman: p };
      });
      setVolunteers(volData);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'volunteers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [type]);

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
      if (editingId) {
        await updateDoc(doc(db, 'volunteers', editingId), {
          ...formData,
          updatedAt: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, 'volunteers'), {
          ...formData,
          createdAt: serverTimestamp()
        });
      }
      setIsModalOpen(false);
      setEditingId(null);
      setFormData({
        policemanId: '',
        type: type,
        cotas: 1
      });
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
      cotas: v.cotas
    });
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Remover este voluntário?')) return;
    try {
      await deleteDoc(doc(db, 'volunteers', id));
      fetchData();
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
        {isAdmin && (
          <button
            onClick={() => setIsModalOpen(true)}
            className="bg-pmpe-navy text-white px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest flex items-center gap-2 hover:bg-slate-800 transition-all shadow-sm"
          >
            <Plus className="w-3.5 h-3.5 text-pmpe-gold" />
            Adicionar Voluntário
          </button>
        )}
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
          filteredVolunteers.map((v, idx) => (
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: idx * 0.05 }}
              key={v.id}
              className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 relative group group-hover:border-pmpe-navy/20 transition-all"
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

              <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
                <div className="flex items-center gap-2 px-2 py-0.5 bg-slate-50 rounded border border-slate-100">
                   <CreditCard className="w-3 h-3 text-slate-400" />
                   <span className="text-[10px] font-black text-slate-600 uppercase tracking-tighter">Cotas: <span className="text-pmpe-navy">{v.cotas}</span></span>
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
          ))
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
              className="bg-white w-full max-w-md rounded-2xl shadow-2xl relative z-[110] overflow-hidden border border-slate-200"
            >
              <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-tighter">
                  {editingId ? `Editar Voluntário ${type}` : `Adicionar Voluntário ${type}`}
                </h3>
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSave} className="p-6 space-y-6">
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Selecionar Policial</label>
                  
                  {/* Searchable UI */}
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
                    
                    <div className="max-h-[200px] overflow-y-auto border border-slate-100 rounded-lg divide-y divide-slate-50 bg-white">
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
                                "text-[11px] font-black uppercase leading-tight",
                                formData.policemanId === p.id ? "text-pmpe-navy" : "text-slate-700"
                              )}>
                                {p.graduacaoPosto} {p.nomeGuerra}
                              </p>
                              <p className="text-[9px] text-slate-400 font-bold uppercase tracking-tighter">Mat: {p.matricula}</p>
                            </div>
                            
                            <div className="flex items-center gap-2">
                              {p.isMotorista && (
                                <span className={cn(
                                  "flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter",
                                  formData.policemanId === p.id ? "bg-pmpe-navy text-white" : "bg-purple-50 text-purple-600"
                                )}>
                                  <Car className="w-2.5 h-2.5" />
                                  Mot.
                                </span>
                              )}
                              {formData.policemanId === p.id && (
                                <UserCheck className="w-3.5 h-3.5 text-pmpe-navy" />
                              )}
                            </div>
                          </button>
                        ))}
                      {policemen.length > 0 && policemen.filter(p => 
                        p.nomeGuerra.toLowerCase().includes(polySearch.toLowerCase()) ||
                        p.nomeCompleto.toLowerCase().includes(polySearch.toLowerCase()) ||
                        p.matricula.includes(polySearch)
                      ).length === 0 && (
                        <div className="p-4 text-center text-[10px] text-slate-400 font-bold tracking-widest uppercase italic">
                          Nenhum policial encontrado
                        </div>
                      )}
                    </div>
                  </div>
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
                  <p className="text-[9px] text-slate-400 mt-2 font-bold uppercase tracking-tight">* Limite mensal de 12 cotas.</p>
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
                    <UserCheck className="w-3.5 h-3.5" />
                    <span>Salvar Dados</span>
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

export default Volunteers;
