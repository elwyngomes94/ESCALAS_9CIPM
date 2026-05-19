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
import { Policeman } from '../types';
import { OperationType, handleFirestoreError, cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  X, 
  Save, 
  User, 
  Phone, 
  CreditCard, 
  Building2,
  ChevronRight,
  Filter,
  Users,
  UserCheck,
  Shield,
  Sparkles,
  Loader2,
  Car
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { parsePersonnelData } from '../services/aiService';

const graduationWeights: { [key: string]: number } = {
  'Coronel': 1,
  'Tenente Coronel': 2,
  'Major': 3,
  'Capitão': 4,
  '1º Tenente': 5,
  '2º Tenente': 6,
  'Subtenente': 7,
  '1º Sargento': 8,
  '2º Sargento': 9,
  '3º Sargento': 10,
  'Cabo': 11,
  'Soldado': 12
};

const Peculio = () => {
  const { isAdmin } = useAuth();
  const [policemen, setPolicemen] = useState<Policeman[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [aiRawText, setAiRawText] = useState('');
  const [aiProcessing, setAiProcessing] = useState(false);
  const [aiPreviewData, setAiPreviewData] = useState<Omit<Policeman, 'id' | 'createdAt'>[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<'all' | 'motorista' | 'ativo' | 'inativo' | 'afastado'>('all');
  
  const [formData, setFormData] = useState<Omit<Policeman, 'id'>>({
    nomeCompleto: '',
    nomeGuerra: '',
    graduacaoPosto: '',
    matricula: '',
    numeral: '',
    antiguidade: 0,
    telefone: '',
    isMotorista: false,
    pelotao: '1º PEL',
    pjesCotasMax: 10,
    opsCotasMax: 10,
    situacao: 'Ativo'
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'policemen'));
      const snap = await getDocs(q);
      let data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Policeman));
      
      // Sorting: Graduation Weight -> Antiguidade -> Numeral -> Nome Guerra
      data.sort((a, b) => {
        const weightA = graduationWeights[a.graduacaoPosto] || 99;
        const weightB = graduationWeights[b.graduacaoPosto] || 99;
        
        if (weightA !== weightB) return weightA - weightB;
        if (a.antiguidade !== b.antiguidade) return (a.antiguidade || 0) - (b.antiguidade || 0);
        
        // Drivers might be grouped or just flagged, following current sorting logic
        
        const numA = parseInt(a.numeral) || 0;
        const numB = parseInt(b.numeral) || 0;
        if (numA !== numB) return numA - numB;
        
        return a.nomeGuerra.localeCompare(b.nomeGuerra);
      });

      setPolicemen(data);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'policemen');
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
        await updateDoc(doc(db, 'policemen', editingId), {
          ...formData,
          updatedAt: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, 'policemen'), {
          ...formData,
          createdAt: serverTimestamp()
        });
      }
      setIsModalOpen(false);
      setEditingId(null);
      setFormData({
        nomeCompleto: '',
        nomeGuerra: '',
        graduacaoPosto: '',
        matricula: '',
        numeral: '',
        antiguidade: 0,
        telefone: '',
        isMotorista: false,
        pelotao: '1º PEL',
        pjesCotasMax: 10,
        opsCotasMax: 10,
        situacao: 'Ativo'
      });
      fetchData();
    } catch (err) {
      console.error("Erro ao salvar policial:", err);
    }
  };

  const handleAiImport = async () => {
    if (!aiRawText.trim()) return;
    setAiProcessing(true);
    try {
      const data = await parsePersonnelData(aiRawText);
      setAiPreviewData(data);
    } catch (err) {
      alert("Erro ao processar dados com IA. Tente novamente.");
    } finally {
      setAiProcessing(false);
    }
  };

  const confirmAiImport = async () => {
    if (aiPreviewData.length === 0) return;
    setAiProcessing(true);
    try {
      const { writeBatch } = await import('firebase/firestore');
      const batch = writeBatch(db);
      
      aiPreviewData.forEach(item => {
        const docRef = doc(collection(db, 'policemen'));
        batch.set(docRef, {
          ...item,
          createdAt: serverTimestamp()
        });
      });
      
      await batch.commit();
      
      setIsAiModalOpen(false);
      setAiRawText('');
      setAiPreviewData([]);
      fetchData();
    } catch (err) {
      console.error("Erro ao importar policiais:", err);
    } finally {
      setAiProcessing(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Deseja realmente excluir este policial?')) return;
    try {
      await deleteDoc(doc(db, 'policemen', id));
      // Optimistic update
      setPolicemen(prev => prev.filter(p => p.id !== id));
    } catch (err) {
      console.error("Erro ao excluir policial:", err);
    }
  };

  const openEditor = (p?: Policeman) => {
    if (p) {
      setEditingId(p.id!);
      setFormData({
        nomeCompleto: p.nomeCompleto,
        nomeGuerra: p.nomeGuerra,
        graduacaoPosto: p.graduacaoPosto,
        matricula: p.matricula,
        numeral: p.numeral || '',
        antiguidade: p.antiguidade || 0,
        telefone: p.telefone,
        isMotorista: p.isMotorista || false,
        pelotao: p.pelotao || '1º PEL',
        pjesCotasMax: p.pjesCotasMax || 10,
        opsCotasMax: p.opsCotasMax || 10,
        situacao: p.situacao
      });
    } else {
      setEditingId(null);
      setFormData({
        nomeCompleto: '',
        nomeGuerra: '',
        graduacaoPosto: '',
        matricula: '',
        numeral: '',
        antiguidade: 0,
        telefone: '',
        isMotorista: false,
        pelotao: '1º PEL',
        pjesCotasMax: 10,
        opsCotasMax: 10,
        situacao: 'Ativo'
      });
    }
    setIsModalOpen(true);
  };

  const filtered = policemen.filter(p => {
    const matchesSearch = p.nomeCompleto.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.nomeGuerra.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.matricula.includes(searchTerm);
    
    if (filterType === 'all') return matchesSearch;
    if (filterType === 'motorista') return matchesSearch && p.isMotorista;
    if (filterType === 'ativo') return matchesSearch && p.situacao === 'Ativo';
    if (filterType === 'inativo') return matchesSearch && p.situacao === 'Inativo';
    if (filterType === 'afastado') return matchesSearch && !['Ativo', 'Inativo'].includes(p.situacao);
    
    return matchesSearch;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-800 uppercase tracking-tighter">Pecúlio (Efetivo)</h2>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Gerenciamento de dados dos policiais</p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsAiModalOpen(true)}
              className="bg-pmpe-gold text-pmpe-navy px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest flex items-center gap-2 hover:bg-amber-400 transition-all shadow-sm"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Importação Inteligente
            </button>
            <button
              onClick={() => openEditor()}
              className="bg-pmpe-navy text-white px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest flex items-center gap-2 hover:bg-slate-800 transition-all shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              Cadastrar Policial
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { id: 'all', label: "Total Efetivo", value: policemen.length, icon: Users, color: "text-blue-600", bg: "bg-blue-50" },
          { id: 'ativo', label: "Ativos", value: policemen.filter(p => p.situacao === 'Ativo').length, icon: UserCheck, color: "text-emerald-600", bg: "bg-emerald-50" },
          { id: 'motorista', label: "Motoristas", value: policemen.filter(p => p.isMotorista).length, icon: Car, color: "text-purple-600", bg: "bg-purple-50" },
          { id: 'inativo', label: "Inativos", value: policemen.filter(p => p.situacao === 'Inativo').length, icon: Filter, color: "text-slate-400", bg: "bg-slate-50" },
          { id: 'afastado', label: "Afastados", value: policemen.filter(p => !['Ativo', 'Inativo'].includes(p.situacao)).length, icon: Shield, color: "text-amber-600", bg: "bg-amber-50" },
        ].map((stat) => (
          <button 
            key={stat.id} 
            onClick={() => setFilterType(stat.id as any)}
            className={cn(
              "bg-white p-3 rounded-xl border transition-all flex items-center gap-3 text-left w-full group",
              filterType === stat.id ? "border-pmpe-navy ring-1 ring-pmpe-navy shadow-md" : "border-slate-200 shadow-sm hover:border-pmpe-navy/30"
            )}
          >
            <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center transition-colors", 
              filterType === stat.id ? "bg-pmpe-navy text-white" : stat.bg,
              filterType !== stat.id && "group-hover:bg-pmpe-navy/5"
            )}>
              <stat.icon className={cn("w-4 h-4", filterType === stat.id ? "text-white" : stat.color)} />
            </div>
            <div>
              <p className={cn("text-[9px] font-black uppercase tracking-wider leading-none mb-1",
                filterType === stat.id ? "text-pmpe-navy/70" : "text-slate-400"
              )}>{stat.label}</p>
              <p className="text-lg font-black text-slate-800 leading-none">{stat.value}</p>
            </div>
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 bg-slate-50/50">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por nome, guerra ou matrícula..."
              className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-pmpe-navy/5 focus:border-pmpe-navy transition-all"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="px-6 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest">Policial</th>
                <th className="px-6 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest">Matrícula</th>
                <th className="px-6 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest">Graduação</th>
                <th className="px-6 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest">Telefone</th>
                <th className="px-6 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest text-center">Situação</th>
                {isAdmin && <th className="px-6 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest text-right">Ações</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={isAdmin ? 6 : 5} className="px-6 py-8 text-center text-xs text-slate-400 font-bold uppercase italic">Carregando dados...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={isAdmin ? 6 : 5} className="px-6 py-8 text-center text-xs text-slate-400 font-bold uppercase italic">Nenhum registro encontrado</td></tr>
              ) : filtered.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/80 transition-colors group">
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-3">
                       <div className="w-8 h-8 rounded bg-slate-100 flex items-center justify-center text-[10px] font-black text-slate-500 group-hover:bg-pmpe-navy group-hover:text-white transition-colors">
                         {p.nomeGuerra.substring(0, 2).toUpperCase()}
                       </div>
                       <div>
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-bold text-slate-800 text-[13px] leading-none">{p.nomeGuerra}</p>
                            {p.isMotorista && (
                              <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter flex items-center gap-1">
                                <Car className="w-2.5 h-2.5" />
                                Motorista
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-400 truncate max-w-[150px] uppercase font-bold tracking-tight">{p.nomeCompleto}</p>
                        </div>
                    </div>
                  </td>
                  <td className="px-6 py-3 text-[11px] font-bold text-slate-600 font-mono tracking-tighter">{p.matricula}</td>
                  <td className="px-6 py-3">
                    <span className="text-[10px] font-black text-pmpe-navy bg-slate-100 px-2 py-0.5 rounded border border-slate-200 uppercase tracking-tight">
                      {p.graduacaoPosto} {p.numeral ? ` - ${p.numeral}` : ''}
                    </span>
                    {p.antiguidade > 0 && <p className="text-[9px] text-slate-400 font-bold uppercase mt-1">Antiguidade: {p.antiguidade}</p>}
                  </td>
                  <td className="px-6 py-3 text-[11px] font-medium text-slate-500">{p.telefone}</td>
                  <td className="px-6 py-3 text-center">
                    <span className={cn(
                      "px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-tighter border",
                      p.situacao === 'Ativo' ? "bg-green-50 text-green-700 border-green-100" : 
                      p.situacao === 'Inativo' ? "bg-red-50 text-red-700 border-red-100" :
                      "bg-slate-50 text-slate-500 border-slate-100"
                    )}>
                      {p.situacao}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="px-6 py-3 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => openEditor(p)}
                          className="p-1.5 text-slate-400 hover:text-pmpe-navy hover:bg-slate-100 rounded transition-all"
                          title="Editar"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(p.id!)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-all"
                          title="Excluir"
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
        {isAiModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAiModalOpen(false)}
              className="absolute inset-0 bg-pmpe-navy/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-200"
            >
              <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                <div>
                  <h3 className="text-sm font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-pmpe-gold" />
                    Importação Inteligente com IA
                  </h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Cole a lista de policiais abaixo para extração automática</p>
                </div>
                <button 
                  onClick={() => setIsAiModalOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                {aiPreviewData.length === 0 ? (
                  <div className="space-y-4">
                    <div className="bg-amber-50 border border-amber-100 p-3 rounded-lg text-[10px] font-bold text-amber-700 uppercase tracking-tight">
                      Dica: Você pode colar dados brutos de planilhas, nomes vindos do WhatsApp ou documentos oficiais. A IA identificará os campos automaticamente.
                    </div>
                    <textarea
                      rows={10}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pmpe-navy/5 focus:border-pmpe-navy transition-all resize-none"
                      placeholder="Ex: 1. Sgt João Silva Matr. 123.456-7, Tel: (87) 99999-9999, Ativo..."
                      value={aiRawText}
                      onChange={(e) => setAiRawText(e.target.value)}
                    />
                    <div className="flex justify-end">
                      <button
                        onClick={handleAiImport}
                        disabled={aiProcessing || !aiRawText.trim()}
                        className="px-8 py-3 bg-pmpe-navy text-white rounded-xl font-bold uppercase tracking-widest text-xs flex items-center gap-2 hover:bg-slate-800 transition-all disabled:opacity-50"
                      >
                        {aiProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                        {aiProcessing ? 'Processando...' : 'Analisar com IA'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                       <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Prévia da Extração ({aiPreviewData.length} registros)</h4>
                       <button 
                         onClick={() => setAiPreviewData([])}
                         className="text-[10px] font-black text-red-500 uppercase tracking-widest hover:underline"
                       >
                         Recomeçar
                       </button>
                    </div>
                    <div className="border border-slate-100 rounded-xl overflow-hidden">
                      <table className="w-full text-[11px] text-left">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-3 py-2 font-black text-slate-400 uppercase">Guerra/Nome</th>
                            <th className="px-3 py-2 font-black text-slate-400 uppercase">Matrícula</th>
                            <th className="px-3 py-2 font-black text-slate-400 uppercase">Grad/Situac/Mot</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {aiPreviewData.map((p, i) => (
                            <tr key={i}>
                              <td className="px-3 py-2">
                                <p className="font-bold text-slate-800 leading-tight">{p.nomeGuerra}</p>
                                <p className="text-[9px] text-slate-400 truncate max-w-[150px] uppercase font-bold">{p.nomeCompleto}</p>
                              </td>
                              <td className="px-3 py-2 font-mono">{p.matricula}</td>
                              <td className="px-3 py-2">
                                <p className="font-bold text-pmpe-navy">{p.graduacaoPosto}</p>
                                <div className="flex items-center gap-1">
                                  <p className="text-[9px] text-slate-400 uppercase">{p.situacao}</p>
                                  {p.isMotorista && <Car className="w-2.5 h-2.5 text-purple-600" />}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              {aiPreviewData.length > 0 && (
                <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                  <button
                    onClick={() => setIsAiModalOpen(false)}
                    className="px-6 py-2 rounded-lg text-xs font-bold uppercase tracking-widest text-slate-500 hover:bg-slate-100 transition-all"
                  >
                    Descartar
                  </button>
                  <button
                    onClick={confirmAiImport}
                    disabled={aiProcessing}
                    className="px-8 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-sm flex items-center gap-2"
                  >
                    {aiProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    Confirmar e Salvar Tudo
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        )}

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
                  {editingId ? 'Editar Policial' : 'Novo Policial'}
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
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Nome Completo</label>
                    <input
                      required
                      type="text"
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pmpe-navy/5 focus:border-pmpe-navy transition-all"
                      value={formData.nomeCompleto}
                      onChange={(e) => setFormData({ ...formData, nomeCompleto: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Nome de Guerra</label>
                    <input
                      required
                      type="text"
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pmpe-navy/5 focus:border-pmpe-navy transition-all"
                      value={formData.nomeGuerra}
                      onChange={(e) => setFormData({ ...formData, nomeGuerra: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Graduação/Posto</label>
                    <select
                      required
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pmpe-navy/5 focus:border-pmpe-navy transition-all appearance-none"
                      value={formData.graduacaoPosto}
                      onChange={(e) => setFormData({ ...formData, graduacaoPosto: e.target.value })}
                    >
                      <option value="">Selecione...</option>
                      <option value="Soldado">Soldado</option>
                      <option value="Cabo">Cabo</option>
                      <option value="3º Sargento">3º Sargento</option>
                      <option value="2º Sargento">2º Sargento</option>
                      <option value="1º Sargento">1º Sargento</option>
                      <option value="Subtenente">Subtenente</option>
                      <option value="2º Tenente">2º Tenente</option>
                      <option value="1º Tenente">1º Tenente</option>
                      <option value="Capitão">Capitão</option>
                      <option value="Major">Major</option>
                      <option value="Tenente Coronel">Tenente Coronel</option>
                      <option value="Coronel">Coronel</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Pelotão / Especialidade</label>
                    <select
                      required
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pmpe-navy/5 focus:border-pmpe-navy transition-all appearance-none"
                      value={formData.pelotao}
                      onChange={(e) => setFormData({ ...formData, pelotao: e.target.value })}
                    >
                      <option value="1º PEL">1º PEL</option>
                      <option value="2º PEL">2º PEL</option>
                      <option value="3º PEL">3º PEL</option>
                      <option value="GATI">GATI</option>
                      <option value="ROCAM">ROCAM</option>
                      <option value="ADMINISTRATIVO">ADMINISTRATIVO</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Matrícula</label>
                    <input
                      required
                      type="text"
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pmpe-navy/5 focus:border-pmpe-navy transition-all"
                      value={formData.matricula}
                      onChange={(e) => setFormData({ ...formData, matricula: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Numeral (Opcional)</label>
                    <input
                      type="text"
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pmpe-navy/5 focus:border-pmpe-navy transition-all"
                      value={formData.numeral}
                      onChange={(e) => setFormData({ ...formData, numeral: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Antiguidade (Posição)</label>
                    <input
                      type="number"
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pmpe-navy/5 focus:border-pmpe-navy transition-all"
                      value={formData.antiguidade}
                      onChange={(e) => setFormData({ ...formData, antiguidade: parseInt(e.target.value) || 0 })}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Telefone</label>
                    <input
                      required
                      type="text"
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pmpe-navy/5 focus:border-pmpe-navy transition-all"
                      value={formData.telefone}
                      onChange={(e) => setFormData({ ...formData, telefone: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Máx. Cotas PJES</label>
                    <input
                      type="number"
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pmpe-navy/5 focus:border-pmpe-navy transition-all"
                      value={formData.pjesCotasMax || 10}
                      onChange={(e) => setFormData({ ...formData, pjesCotasMax: parseInt(e.target.value) || 10 })}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Máx. Cotas OPS</label>
                    <input
                      type="number"
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pmpe-navy/5 focus:border-pmpe-navy transition-all"
                      value={formData.opsCotasMax || 10}
                      onChange={(e) => setFormData({ ...formData, opsCotasMax: parseInt(e.target.value) || 10 })}
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="flex items-center gap-2 cursor-pointer group bg-slate-50 p-3 rounded-lg border border-slate-200 hover:border-pmpe-navy transition-all">
                      <input
                        type="checkbox"
                        className="w-4 h-4 text-pmpe-navy border-slate-300 rounded focus:ring-pmpe-navy"
                        checked={formData.isMotorista}
                        onChange={(e) => setFormData({ ...formData, isMotorista: e.target.checked })}
                      />
                      <div className="flex items-center gap-2">
                        <Car className="w-4 h-4 text-pmpe-navy" />
                        <span className="text-xs font-black text-slate-700 uppercase tracking-widest">Policial do Quadro de Motorista</span>
                      </div>
                    </label>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Situação</label>
                    <div className="flex flex-wrap gap-4">
                      {['Ativo', 'Férias', 'Inativo', 'Licença', 'Agregado'].map((s) => (
                        <label key={s} className="flex items-center gap-2 cursor-pointer group">
                          <input
                            type="radio"
                            name="situacao"
                            className="w-4 h-4 text-pmpe-navy border-slate-300 focus:ring-pmpe-navy"
                            checked={formData.situacao === s}
                            onChange={() => setFormData({ ...formData, situacao: s })}
                          />
                          <span className="text-xs font-bold text-slate-600 group-hover:text-pmpe-navy transition-colors">{s}</span>
                        </label>
                      ))}
                    </div>
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
                    {editingId ? 'Salvar Alterações' : 'Confirmar Cadastro'}
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

export default Peculio;
