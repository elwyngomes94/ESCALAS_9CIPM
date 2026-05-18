import React, { useState, useEffect, useRef } from 'react';
import { 
  collection, 
  getDocs, 
  updateDoc, 
  deleteDoc, 
  doc,
  query, 
  orderBy,
  where,
  serverTimestamp
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Escala, ServiceType, Policeman } from '../types';
import { OperationType, handleFirestoreError, cn } from '../lib/utils';
import { sortPolicemen } from '../lib/utils/policeUtils';
import { useAuth } from '../contexts/AuthContext';
import { 
  Search, 
  Calendar as CalendarIcon, 
  Filter, 
  MapPin, 
  Briefcase,
  User,
  Info,
  ChevronDown,
  Clock,
  X,
  Users,
  FileDown,
  Share2,
  FileSpreadsheet,
  MessageCircle,
  FileText,
  Printer,
  ClipboardList,
  Edit2,
  Trash2,
  Save,
  AlertTriangle,
  LayoutGrid,
  Calendar as CalendarViewIcon,
  ChevronLeft,
  ChevronRight,
  Crown,
  Car,
  Download
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths, getDate } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import html2canvas from 'html2canvas';

const Escalas = () => {
  const { isAdmin } = useAuth();
  const [escalas, setEscalas] = useState<(Escala & { service?: ServiceType, policemen?: Policeman[] })[]>([]);
  const [services, setServices] = useState<ServiceType[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'list' | 'calendar' | 'official'>('list');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  
  const [selectedServiceId, setSelectedServiceId] = useState<string>('');
  
  const [generatingReport, setGeneratingReport] = useState(false);
  const [scaleToPrint, setScaleToPrint] = useState<any>(null);
  
  const officialRef = useRef<HTMLDivElement>(null);
  const printSingleRef = useRef<HTMLDivElement>(null);

  // Edit State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editFormData, setEditFormData] = useState({
    date: '',
    serviceTypeId: '',
    observations: ''
  });

  // Filters
  const [filterDate, setFilterDate] = useState('');
  const [filterCity, setFilterCity] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterPolice, setFilterPolice] = useState('');

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);

  const monthKey = format(currentMonth, 'yyyy-MM');

  const fetchData = async () => {
    setLoading(true);
    try {
      const eQ = query(collection(db, 'escalas'), orderBy('date', 'desc'));
      const eSnap = await getDocs(eQ);
      
      const sSnap = await getDocs(query(collection(db, 'serviceTypes'), where('month', '==', monthKey)));
      const sData = sSnap.docs.map(d => ({ id: d.id, ...d.data() } as ServiceType));
      setServices(sData);
      
      const pSnap = await getDocs(collection(db, 'policemen'));
      const pData = pSnap.docs.map(d => ({ id: d.id, ...d.data() } as Policeman));

      const data = eSnap.docs.map(eDoc => {
        const e = { id: eDoc.id, ...eDoc.data() } as Escala;
        const s = sData.find(serv => serv.id === e.serviceTypeId);
        const poly = pData.filter(police => e.policemenIds.includes(police.id!));
        // Hierarchy sorting
        const sortedPoly = sortPolicemen(poly);
        return { ...e, service: s, policemen: sortedPoly };
      });
      setEscalas(data);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'escalas');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [currentMonth]);

  const exportToPDF = async (esc: any) => {
    setGeneratingReport(true);
    // Setting scaleToPrint will trigger the hidden renderer
    setScaleToPrint(esc);
    
    // Wait for the DOM to update
    setTimeout(async () => {
      try {
        if (!printSingleRef.current) throw new Error("Renderizador não encontrado");
        
        const canvas = await html2canvas(printSingleRef.current, {
          scale: 3,
          useCORS: true,
          backgroundColor: '#ffffff',
          logging: false
        });

        const imgData = canvas.toDataURL('image/png', 1.0);
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        
        const margin = 10;
        const imgWidth = pageWidth - (margin * 2);
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        
        let finalHeight = imgHeight;
        let finalWidth = imgWidth;
        
        if (imgHeight > pageHeight - (margin * 2)) {
          finalHeight = pageHeight - (margin * 2);
          finalWidth = (canvas.width * finalHeight) / canvas.height;
        }

        const xPos = (pageWidth - finalWidth) / 2;
        pdf.addImage(imgData, 'PNG', xPos, margin, finalWidth, finalHeight, undefined, 'FAST');
        
        const dateStr = format(esc.date.toDate(), 'dd_MM_yyyy');
        pdf.save(`Escala_Oficial_9CIPM_${esc.service?.sigla || 'ESC'}_${dateStr}.pdf`);
      } catch (err) {
        console.error(err);
        alert('Erro ao gerar PDF individual');
      } finally {
        setGeneratingReport(false);
        setScaleToPrint(null);
      }
    }, 500);
  };

  const exportToExcel = (esc: any) => {
    const dateStr = format(esc.date.toDate(), 'dd/MM/yyyy');
    const data = esc.policemen.map((p: any, idx: number) => {
      let role = idx === 0 ? 'Comandante' : 'Patrulheiro';
      if (p.isMotorista) role = 'Motorista';
      return {
        'Função': role,
        'Posto/Graduação': p.graduacaoPosto,
        'Nome de Guerra': p.nomeGuerra,
        'Matrícula': p.matricula,
        'Telefone': p.telefone,
        'Cidade': esc.service?.cidade,
        'Início': esc.service?.horarioInicio,
        'Término': esc.service?.horarioTermino
      };
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Escala");
    XLSX.writeFile(wb, `escala_${esc.service?.nome}_${dateStr}.xlsx`);
  };

  const shareWhatsApp = (esc: any) => {
    const dateStr = format(esc.date.toDate(), 'dd/MM/yyyy');
    let message = `*ESCALA DE SERVIÇO - PMPE*\n\n`;
    message += `*Serviço:* ${esc.service?.nome}\n`;
    message += `*Apoio/Tipo:* ${esc.service?.tipo}\n`;
    message += `*Data:* ${dateStr}\n`;
    message += `*Horário:* ${esc.service?.horarioInicio} às ${esc.service?.horarioTermino}\n`;
    message += `*Cidade:* ${esc.service?.cidade}\n\n`;
    message += `*EFETIVO ESCALADO:*\n`;
    
    esc.policemen.forEach((p: any, i: number) => {
      message += `${i + 1}. ${p.graduacaoPosto} ${p.nomeGuerra} (${p.matricula}) 👮🚨\n`;
    });

    if (esc.observations) {
      message += `\n*OBSERVAÇÕES:*\n${esc.observations}`;
    }

    const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
  };

  const handleEdit = (esc: any) => {
    setEditingId(esc.id);
    setEditFormData({
      date: format(esc.date.toDate(), 'yyyy-MM-dd'),
      serviceTypeId: esc.serviceTypeId,
      observations: esc.observations || ''
    });
    setIsEditModalOpen(true);
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId) return;
    
    try {
      await updateDoc(doc(db, 'escalas', editingId), {
        date: new Date(editFormData.date),
        serviceTypeId: editFormData.serviceTypeId,
        observations: editFormData.observations,
        updatedAt: serverTimestamp()
      });
      setIsEditModalOpen(false);
      setEditingId(null);
      fetchData();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'escalas');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Excluir esta escala definitivamente?')) return;
    try {
      await deleteDoc(doc(db, 'escalas', id));
      // Optimistic update: remove from local state immediately
      setEscalas(prev => prev.filter(e => e.id !== id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'escalas');
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Excluir ${selectedIds.length} escalas permanentemente?`)) return;
    
    setLoading(true);
    try {
      const { writeBatch } = await import('firebase/firestore');
      const batch = writeBatch(db);
      
      selectedIds.forEach(id => {
        batch.delete(doc(db, 'escalas', id));
      });
      
      await batch.commit();
      
      // Optimistic update: remove all selected from local state
      setEscalas(prev => prev.filter(e => !selectedIds.includes(e.id!)));
      setSelectedIds([]);
      setIsSelectionMode(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'escalas_bulk');
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const getReportScales = () => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    return escalas.filter(esc => {
      const escDate = esc.date.toDate();
      return escDate >= monthStart && escDate <= monthEnd;
    });
  };

  const exportBatchPDF = async () => {
    // Official Mode Multi-page
    if (!officialRef.current) return;
    setGeneratingReport(true);
    try {
      const tables = officialRef.current.querySelectorAll('.official-report-table');
      if (tables.length === 0) {
        alert('Nenhuma escala encontrada para gerar o relatório.');
        setGeneratingReport(false);
        return;
      }

      // We use Landscape if the table is very wide, but military scales are usually Portrait
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      for (let i = 0; i < tables.length; i++) {
        const table = tables[i] as HTMLElement;
        
        // Ensure background is solid white for the capture
        const originalBg = table.style.backgroundColor;
        table.style.backgroundColor = '#ffffff';

        const canvas = await html2canvas(table, {
          scale: 3, // Higher resolution for printing
          useCORS: true,
          logging: false,
          backgroundColor: '#ffffff',
          windowWidth: 1200 // Force a consistent width for rendering
        });

        table.style.backgroundColor = originalBg;

        const imgData = canvas.toDataURL('image/png', 1.0);
        const margin = 10;
        const imgWidth = pageWidth - (margin * 2); 
        const imgHeight = (canvas.height * imgWidth) / canvas.width;

        if (i > 0) pdf.addPage();
        
        // If the table is longer than a page, we might need to handle splitting, 
        // but for monthly scales of 30 days they usually fit one A4 page at 12px font.
        // If it overlaps, we scale it down slightly more.
        let finalImgHeight = imgHeight;
        let finalImgWidth = imgWidth;
        
        if (imgHeight > pageHeight - (margin * 2)) {
           finalImgHeight = pageHeight - (margin * 2);
           finalImgWidth = (canvas.width * finalImgHeight) / canvas.height;
        }

        const xPos = (pageWidth - finalImgWidth) / 2;

        pdf.addImage(imgData, 'PNG', xPos, margin, finalImgWidth, finalImgHeight, undefined, 'FAST');
      }

      pdf.save(`Escala_Mensal_9CIPM_${format(currentMonth, 'MMMM_yyyy', { locale: ptBR })}.pdf`);
    } catch (err) {
      console.error(err);
      alert('Erro ao gerar PDF: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setGeneratingReport(false);
    }
  };

  const shareBatchWhatsApp = () => {
    // ... removed or repurposed ...
  };

  const shareOfficialWhatsApp = () => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const filteredServices = services.filter(s => {
      const isCorrectMonth = s.month === format(currentMonth, 'yyyy-MM');
      const isSelected = selectedServiceId ? s.id === selectedServiceId : true;
      return isCorrectMonth && isSelected;
    });

    if (filteredServices.length === 0) return alert('Nenhum serviço disponível para compartilhar.');

    let message = `*ESCALA MENSAL - 9ª CIPM*\n`;
    message += `*Mês:* ${format(currentMonth, 'MMMM yyyy', { locale: ptBR })}\n`;
    message += `----------------------------\n\n`;

    filteredServices.forEach(service => {
      message += `*📍 ${service.nome}*\n`;
      message += `*Local:* ${service.cidade} | ${service.horarioInicio} às ${service.horarioTermino}\n\n`;
      
      const serviceScales = escalas.filter(e => 
        e.serviceTypeId === service.id && 
        e.date.toDate() >= monthStart && e.date.toDate() <= monthEnd
      ).sort((a, b) => a.date.toDate().getTime() - b.date.toDate().getTime());

      if (serviceScales.length === 0) {
        message += `_Sem escalas publicadas para este serviço._\n\n`;
      } else {
        serviceScales.forEach(esc => {
          const day = format(esc.date.toDate(), 'dd/MM (eee)', { locale: ptBR });
          message += `*Dia ${day}:*\n`;
          esc.policemen?.forEach((p, idx) => {
            const role = idx === 0 ? '👑' : (p.isMotorista ? '🚗' : '👤');
            message += ` - ${role} ${p.graduacaoPosto} ${p.nomeGuerra} [Mat: ${p.matricula}] 👮🚨\n`;
          });
          message += `\n`;
        });
      }
      message += `----------------------------\n\n`;
    });

    const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
  };

  const filteredEscalas = escalas.filter(esc => {
    const matchesDate = filterDate ? format(esc.date.toDate(), 'yyyy-MM-dd') === filterDate : true;
    const matchesCity = filterCity ? esc.service?.cidade.toLowerCase().includes(filterCity.toLowerCase()) : true;
    const matchesType = filterType ? esc.service?.tipo === filterType : true;
    const matchesPolice = filterPolice ? esc.policemen?.some(p => p.nomeGuerra.toLowerCase().includes(filterPolice.toLowerCase())) : true;
    
    return matchesDate && matchesCity && matchesType && matchesPolice;
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-black text-slate-800 uppercase tracking-tighter">Escalas Publicadas</h2>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Consulta e acompanhamento operacional</p>
      </div>

      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4 pb-4 border-b border-slate-50">
          <div className="flex items-center gap-2">
            <div className="flex p-0.5 bg-slate-100 rounded-lg border border-slate-200">
              <button
                onClick={() => setViewMode('list')}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-md text-[10px] font-black uppercase tracking-tight transition-all",
                  viewMode === 'list' 
                    ? "bg-white text-pmpe-navy shadow-sm" 
                    : "text-slate-400 hover:text-slate-600"
                )}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                Lista
              </button>
              <button
                onClick={() => setViewMode('calendar')}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-md text-[10px] font-black uppercase tracking-tight transition-all",
                  viewMode === 'calendar' 
                    ? "bg-white text-pmpe-navy shadow-sm" 
                    : "text-slate-400 hover:text-slate-600"
                )}
              >
                <CalendarViewIcon className="w-3.5 h-3.5" />
                Calendário
              </button>
              <button
                onClick={() => setViewMode('official')}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-md text-[10px] font-black uppercase tracking-tight transition-all",
                  viewMode === 'official' 
                    ? "bg-white text-pmpe-navy shadow-sm" 
                    : "text-slate-400 hover:text-slate-600"
                )}
              >
                <Printer className="w-3.5 h-3.5" />
                Escala Mensal
              </button>
            </div>

            {(viewMode === 'calendar' || viewMode === 'official') && (
              <div className="flex items-center gap-2 ml-4">
                <button 
                  onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                  className="p-1 text-slate-400 hover:text-pmpe-navy hover:bg-slate-50 rounded-lg transition-all"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-[11px] font-black text-pmpe-navy uppercase tracking-widest min-w-[120px] text-center">
                  {format(currentMonth, 'MMMM yyyy', { locale: ptBR })}
                </span>
                <button 
                  onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                  className="p-1 text-slate-400 hover:text-pmpe-navy hover:bg-slate-50 rounded-lg transition-all"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isAdmin && (
              <div className="flex items-center gap-2">
                {viewMode === 'official' && (
                  <>
                    <button
                      onClick={() => {
                        setGeneratingReport(true);
                        setTimeout(async () => {
                          await exportBatchPDF();
                          setGeneratingReport(false);
                        }, 100);
                      }}
                      disabled={generatingReport}
                      className={cn(
                        "px-3 py-1.5 text-[9px] font-black text-white uppercase tracking-widest bg-emerald-600 rounded-lg shadow-sm hover:bg-emerald-700 transition-all flex items-center gap-2",
                        generatingReport && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      {generatingReport ? (
                        <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                      Baixar PDF
                    </button>
                    <button
                      onClick={shareOfficialWhatsApp}
                      className="px-3 py-1.5 text-[9px] font-black text-white uppercase tracking-widest bg-green-600 rounded-lg shadow-sm hover:bg-green-700 transition-all flex items-center gap-2"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      WhatsApp
                    </button>
                  </>
                )}
                <div className="w-px h-6 bg-slate-200 mx-1" />
                {isSelectionMode ? (
                  <>
                    <button 
                      onClick={() => {
                        if (selectedIds.length === filteredEscalas.length) {
                          setSelectedIds([]);
                        } else {
                          setSelectedIds(filteredEscalas.map(esc => esc.id!));
                        }
                      }}
                      className="px-3 py-1.5 text-[9px] font-black text-pmpe-navy uppercase tracking-widest border border-pmpe-navy/20 rounded-lg hover:bg-slate-50 transition-all flex items-center gap-2"
                    >
                      {selectedIds.length === filteredEscalas.length ? 'Desmarcar Todas' : 'Selecionar Todas'}
                    </button>
                    <button 
                      onClick={() => { setSelectedIds([]); setIsSelectionMode(false); }}
                      className="px-3 py-1.5 text-[9px] font-black text-slate-500 uppercase tracking-widest border border-slate-200 rounded-lg hover:bg-slate-50 transition-all"
                    >
                      Cancelar
                    </button>
                    <button 
                      onClick={handleBulkDelete}
                      disabled={selectedIds.length === 0}
                      className={cn(
                        "px-3 py-1.5 text-[9px] font-black text-white uppercase tracking-widest bg-red-500 rounded-lg shadow-sm transition-all flex items-center gap-2",
                        selectedIds.length === 0 && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Excluir {selectedIds.length}
                    </button>
                  </>
                ) : (
                  <button 
                    onClick={() => setIsSelectionMode(true)}
                    className="px-3 py-1.5 text-[9px] font-black text-pmpe-navy uppercase tracking-widest border border-pmpe-navy/20 rounded-lg hover:bg-slate-50 transition-all flex items-center gap-2"
                  >
                    <ClipboardList className="w-3.5 h-3.5" />
                    Seleção em Massa
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 ml-1">Filtrar Data</label>
            <div className="relative">
               <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
               <input
                 type="date"
                 value={filterDate}
                 onChange={(e) => setFilterDate(e.target.value)}
                 className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-pmpe-navy outline-none"
               />
            </div>
          </div>
          <div>
            <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 ml-1">Cidade</label>
            <div className="relative">
               <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
               <input
                 type="text"
                 placeholder="Araripina..."
                 value={filterCity}
                 onChange={(e) => setFilterCity(e.target.value)}
                 className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-pmpe-navy outline-none"
               />
            </div>
          </div>
          <div>
            <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 ml-1">Tipo</label>
            <div className="relative">
               <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
               <select
                 value={filterType}
                 onChange={(e) => setFilterType(e.target.value)}
                 className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-pmpe-navy outline-none appearance-none"
               >
                 <option value="">TODOS</option>
                 <option value="PJES">PJES</option>
                 <option value="OPS">OPS</option>
               </select>
            </div>
          </div>
          <div>
            <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 ml-1">Ativo</label>
            <div className="relative">
               <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
               <input
                 type="text"
                 placeholder="Guerra ou Matrícula..."
                 value={filterPolice}
                 onChange={(e) => setFilterPolice(e.target.value)}
                 className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-pmpe-navy outline-none"
               />
            </div>
          </div>
        </div>
        
        {(filterDate || filterCity || filterType || filterPolice) && (
            <button 
                onClick={() => { setFilterDate(''); setFilterCity(''); setFilterType(''); setFilterPolice(''); }}
                className="mt-3 text-[9px] font-black text-red-500 uppercase flex items-center gap-1 hover:underline"
            >
                <X className="w-2.5 h-2.5" /> Limpar filtros
            </button>
        )}
      </div>

      {viewMode === 'calendar' ? (
        <div className="grid grid-cols-7 gap-px bg-slate-200 border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(day => (
            <div key={day} className="bg-slate-100 p-2 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-200">
              {day}
            </div>
          ))}
          {eachDayOfInterval({
            start: startOfMonth(currentMonth),
            end: endOfMonth(currentMonth)
          }).map((day, i) => {
            const dayScales = escalas.filter(esc => isSameDay(esc.date.toDate(), day));
            const isToday = isSameDay(day, new Date());
            
            return (
              <div 
                key={day.toISOString()} 
                className={cn(
                  "bg-white min-h-[140px] p-2 flex flex-col gap-1 transition-colors hover:bg-slate-50/50",
                  i === 0 && `col-start-${day.getDay() + 1}`
                )}
              >
                <div className="flex justify-between items-center mb-1">
                  <span className={cn(
                    "text-[10px] font-black w-6 h-6 flex items-center justify-center rounded-full",
                    isToday ? "bg-pmpe-navy text-white shadow-sm" : "text-slate-400"
                  )}>
                    {format(day, 'd')}
                  </span>
                </div>
                
                <div className="flex flex-col gap-1 overflow-y-auto max-h-[110px] custom-scrollbar scrollbar-hide">
                  {dayScales.map(esc => (
                    <button
                      key={esc.id}
                      onClick={() => { setExpandedId(expandedId === esc.id ? null : esc.id!); setViewMode('list'); }}
                      className={cn(
                        "text-[9px] font-bold p-1.5 rounded border text-left flex flex-col gap-0.5 group transition-all",
                        esc.service?.tipo === 'PJES' 
                          ? "bg-blue-50 border-blue-100 text-blue-700 hover:bg-blue-100 shadow-xs" 
                          : "bg-emerald-50 border-emerald-100 text-emerald-700 hover:bg-emerald-100 shadow-xs"
                      )}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate font-black">{esc.service?.nome}</span>
                      </div>
                      <div className="flex items-center justify-between text-[8px] opacity-70">
                        <span className="flex items-center gap-0.5"><Users className="w-2 h-2" /> {esc.policemen?.length}</span>
                        <span>{esc.service?.horarioInicio}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : viewMode === 'official' ? (
        <div className="space-y-8 bg-slate-50 p-6 rounded-[24px] border border-slate-200 shadow-inner">
           <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="flex items-center gap-4">
                 <div className="w-12 h-12 rounded-xl bg-pmpe-navy/5 flex items-center justify-center border border-pmpe-navy/10">
                   <Filter className="w-6 h-6 text-pmpe-navy" />
                 </div>
                 <div>
                   <h4 className="text-[11px] font-black text-pmpe-navy uppercase tracking-[0.2em]">Configuração de Visualização</h4>
                   <p className="text-[10px] font-medium text-slate-400">Selecione o serviço para detalhamento mensal</p>
                 </div>
              </div>
              <select 
                value={selectedServiceId}
                onChange={(e) => setSelectedServiceId(e.target.value)}
                className="bg-slate-50 border-2 border-slate-100 rounded-xl px-4 py-3 text-xs font-black text-pmpe-navy outline-none focus:ring-2 focus:ring-pmpe-navy/20 focus:border-pmpe-navy transition-all min-w-[300px] appearance-none cursor-pointer"
                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%231e293b'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 1rem center', backgroundSize: '1em' }}
              >
                <option value="">TODOS OS SERVIÇOS DO MÊS</option>
                {services.filter(s => s.month === format(currentMonth, 'yyyy-MM')).map(s => (
                  <option key={s.id} value={s.id!}>{s.nome} - {s.tipo}</option>
                ))}
              </select>
           </div>

           {(() => {
              const monthStart = startOfMonth(currentMonth);
              const monthEnd = endOfMonth(currentMonth);
              const filteredServices = services.filter(s => {
                const isCorrectMonth = s.month === format(currentMonth, 'yyyy-MM');
                const isSelected = selectedServiceId ? s.id === selectedServiceId : true;
                return isCorrectMonth && isSelected;
              });
              
              if (filteredServices.length === 0) return (
                <div className="text-center py-24 bg-white rounded-[32px] border-2 border-dashed border-slate-200">
                  <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-100">
                    <ClipboardList className="w-8 h-8 text-slate-200" />
                  </div>
                  <p className="text-[12px] font-black uppercase text-slate-400 tracking-[0.2em]">Nenhum serviço configurado para este mês</p>
                </div>
              );

              return (
                <div className="space-y-12" ref={officialRef}>
                  {filteredServices.map(service => {
                    const serviceScales = escalas.filter(e => 
                      e.serviceTypeId === service.id && 
                      e.date.toDate() >= monthStart && e.date.toDate() <= monthEnd
                    );
                    
                    const monthDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
                    const rows: any[] = [];
                    monthDays.forEach(day => {
                      const dayScales = serviceScales.filter(e => isSameDay(e.date.toDate(), day));
                      if (dayScales.length === 0) {
                        rows.push({ day: getDate(day), pol: null, date: day });
                      } else {
                        dayScales.forEach(esc => {
                          esc.policemen?.forEach(p => {
                            rows.push({ day: getDate(day), pol: p, esc, date: day });
                          });
                        });
                      }
                    });

                    const totalCotasValue = rows.reduce((acc, row) => acc + (row.pol ? 1 : 0), 0);

                    return (
                      <div key={service.id} className="official-report-table bg-white p-6 shadow-[0_20px_50px_rgba(0,0,0,0.1)] border border-slate-200 rounded-[2px] overflow-x-auto relative mb-20 last:mb-0">
                        {/* Military Stamp Look */}
                        <div className="absolute top-10 right-10 opacity-10 border-4 border-pmpe-navy p-3 rounded-2xl rotate-12 pointer-events-none z-0">
                           <span className="text-3xl font-black text-pmpe-navy uppercase">9ª CIPM - OFICIAL</span>
                        </div>

                        <div className="min-w-[950px] bg-white relative z-10">
                            {/* Header Section */}
                            <div className="border-b-[4px] border-black pb-6 mb-6 flex items-center gap-10">
                               <div className="w-24 h-24 flex-shrink-0">
                                  <img 
                                    src="https://upload.wikimedia.org/wikipedia/commons/thumb/c/c8/Bras%C3%A3o_da_PMPE.svg/1200px-Bras%C3%A3o_da_PMPE.svg.png" 
                                    alt="PMPE" 
                                    className="w-full h-full object-contain"
                                    referrerPolicy="no-referrer"
                                    crossOrigin="anonymous"
                                  />
                               </div>
                               <div className="flex-1 text-center">
                                  <h1 className="text-[20px] font-black text-black leading-tight uppercase tracking-tight mb-1">Polícia Militar de Pernambuco</h1>
                                  <h2 className="text-[16px] font-bold text-black leading-tight uppercase mb-0.5">PM/DPO - Diretoria de Planejamento Operacional</h2>
                                  <h3 className="text-[16px] font-bold text-black leading-tight uppercase">9ª CIPM - Companhia Independente da Polícia Militar</h3>
                                  <p className="text-[12px] font-bold text-slate-500 uppercase mt-1 tracking-widest">(Araripina - Pernambuco)</p>
                               </div>
                               <div className="w-24 h-24 opacity-0 flex-shrink-0">PMPE</div>
                            </div>

                            <div 
                              className="text-white font-black text-center py-4 border-x-2 border-t-2 border-black uppercase text-base shadow-[inset_0_2px_20px_rgba(255,255,255,0.4)] relative overflow-hidden"
                              style={{ backgroundColor: service.color || '#1e293b' }}
                            >
                              <div className="absolute inset-0 bg-black/15 mix-blend-overlay"></div>
                              ESCALA NOMINAL DO SERVIÇO: {service.nome} – {format(currentMonth, 'MMMM yyyy', { locale: ptBR })}
                            </div>
                            
                            <div className="bg-slate-100 text-black font-black text-center py-3 border-2 border-black uppercase text-[11px] tracking-widest flex items-center justify-center gap-12">
                              <span className="flex items-center gap-2"><MapPin className="w-4 h-4 text-pmpe-navy" /> LOCAL: {service.cidade}</span>
                              <span className="flex items-center gap-2"><Clock className="w-4 h-4 text-pmpe-navy" /> HORÁRIO: {service.horarioInicio} ÀS {service.horarioTermino}</span>
                              <span className="flex items-center gap-2"><Info className="w-4 h-4 text-pmpe-navy" /> MODALIDADE: {service.categoria || 'P.O'}</span>
                            </div>

                            <table className="w-full border-collapse border-b-2 border-black text-[12px]">
                              <thead>
                                <tr className="bg-slate-50 font-black uppercase text-center border-x-2 border-black border-b border-black">
                                  <th className="border-r-2 border-black py-4 px-1 w-[12%]">GRADUAÇÃO</th>
                                  <th className="border-r-2 border-black py-4 px-1 w-[12%]">MATRÍCULA</th>
                                  <th className="border-r-2 border-black py-4 px-1">NOME DE GUERRA</th>
                                  <th className="border-r-2 border-black py-4 px-1 w-[12%] text-[10px]">ORGANIZAÇÃO (OME)</th>
                                  <th className="border-r-2 border-black py-4 px-1 w-[10%]">FUNÇÃO</th>
                                  <th className="border-r-2 border-black py-4 px-1 w-[6%]">DIA</th>
                                  <th className="border-r-2 border-black py-4 px-1 w-[6%]">COTA</th>
                                  <th className="py-4 px-1 w-[18%]">JORNADA</th>
                                </tr>
                              </thead>
                              <tbody>
                                {rows.map((row, idx) => {
                                  const isWknd = row.date.getDay() === 0 || row.date.getDay() === 6;
                                  return (
                                    <tr 
                                      key={idx} 
                                      className={cn(
                                        "border-x-2 border-b border-black/30 text-center transition-colors font-mono",
                                        idx === rows.length - 1 && "border-b-2 border-black",
                                        isWknd ? "bg-red-50/30" : idx % 2 === 0 ? "bg-white" : "bg-slate-50/40"
                                      )}
                                    >
                                      <td className="border-r-2 border-black py-2 font-black text-slate-800">{row.pol?.graduacaoPosto || '---'}</td>
                                      <td className="border-r-2 border-black py-2 font-black text-slate-800">{row.pol?.matricula || '---'}</td>
                                      <td className="border-r-2 border-black py-2 font-black text-left px-5 uppercase text-pmpe-navy">{row.pol?.nomeGuerra || ''}</td>
                                      <td className="border-r-2 border-black py-2 font-bold text-slate-500 text-[11px]">9ª CIPM</td>
                                      <td className="border-r-2 border-black py-2 font-bold text-slate-500 text-[10px]">{service.categoria || 'P.O'}</td>
                                      <td className={cn(
                                        "border-r-2 border-black py-2 font-black text-[14px]",
                                        isWknd ? "text-red-700 bg-red-50/50" : "text-black"
                                      )}>{row.day.toString().padStart(2, '0')}</td>
                                      <td className="border-r-2 border-black py-2 font-black text-slate-800">{row.pol ? '01' : '00'}</td>
                                      <td className="font-bold py-2 text-slate-600 text-[11px]">{service.horarioInicio} às {service.horarioTermino}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                              <tfoot>
                                <tr className="bg-slate-100 font-black border-x-2 border-b-2 border-black h-16">
                                  <td colSpan={6} className="p-3 text-right pr-8 border-r-2 border-black uppercase text-sm tracking-[0.2em]">TOTAL DE COTAS DO MÊS:</td>
                                  <td className="p-3 text-center bg-white border-r-2 border-black text-2xl text-pmpe-navy font-black shadow-inner">{totalCotasValue.toString().padStart(2, '0')}</td>
                                  <td className="bg-white"></td>
                                </tr>
                              </tfoot>
                            </table>

                            {/* Signature Footer */}
                            <div className="mt-16 grid grid-cols-2 gap-20 px-16 text-center">
                               <div className="pt-10 border-t-2 border-black">
                                  <p className="text-[13px] font-black uppercase mb-1">Chefe da Seção de Planejamento (P/3)</p>
                                  <p className="text-[11px] font-bold text-slate-500 tracking-wider">9ª CIPM - ARARIPINA-PE</p>
                               </div>
                               <div className="pt-10 border-t-2 border-black">
                                  <p className="text-[13px] font-black uppercase mb-1">Comandante da 9ª CIPM</p>
                                  <p className="text-[11px] font-bold text-slate-500 tracking-wider">9ª CIPM - ARARIPINA-PE</p>
                               </div>
                            </div>

                            <div className="mt-12 text-center text-[10px] font-bold text-slate-400 italic">
                               Relatório gerado em {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })} através do Sistema Integrado de Escalas (CIPM/9)
                            </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
           })()}
        </div>
      ) : (
        <div className="space-y-2">
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-white p-4 rounded-xl border border-slate-200 animate-pulse h-16" />
            ))
          ) : filteredEscalas.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400 font-bold uppercase italic bg-white rounded-xl border border-dashed border-slate-200 flex flex-col items-center gap-3">
               <ClipboardList className="w-6 h-6 opacity-20" />
               Nenhuma escala encontrada.
            </div>
          ) : (
          filteredEscalas.map((esc) => (
            <div 
              key={esc.id} 
              className={cn(
                "bg-white rounded-xl border transition-all overflow-hidden",
                selectedIds.includes(esc.id!) ? "border-red-200 ring-1 ring-red-100 bg-red-50/10 shadow-md" : "border-slate-200 shadow-sm"
              )}
            >
              <div 
                onClick={() => isSelectionMode ? toggleSelect(esc.id!) : setExpandedId(expandedId === esc.id ? null : esc.id)}
                className="p-3 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  {isSelectionMode && (
                    <div 
                      className={cn(
                        "w-5 h-5 rounded border flex items-center justify-center transition-all",
                        selectedIds.includes(esc.id!) ? "bg-red-500 border-red-500" : "bg-white border-slate-300"
                      )}
                    >
                      {selectedIds.includes(esc.id!) && <X className="w-3.5 h-3.5 text-white" />}
                    </div>
                  )}
                  <div className="w-10 h-10 rounded-lg bg-pmpe-navy/5 flex flex-col items-center justify-center border border-pmpe-navy/10 group-hover:bg-pmpe-navy transition-colors">
                    <span className="text-[8px] font-black text-slate-400 uppercase leading-none mb-0.5 group-hover:text-pmpe-gold transition-colors">{format(esc.date.toDate(), 'MMM', { locale: ptBR })}</span>
                    <span className="text-sm font-black text-pmpe-navy leading-none group-hover:text-white transition-colors">{format(esc.date.toDate(), 'dd')}</span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "text-[8px] font-black tracking-widest px-1.5 rounded-sm border",
                        esc.service?.tipo === 'PJES' ? "bg-pmpe-navy text-white border-pmpe-navy" : "bg-pmpe-gold text-pmpe-navy border-pmpe-gold/20"
                      )}>
                        {esc.service?.tipo}
                      </span>
                      <h3 className="font-bold text-slate-800 text-[13px]">{esc.service?.nome}</h3>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-[10px] text-slate-400 font-bold uppercase tracking-tight">
                       <div className="flex items-center gap-1">
                          <MapPin className="w-2.5 h-2.5" />
                          {esc.service?.cidade}
                       </div>
                       <div className="flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" />
                          {esc.service?.horarioInicio} - {esc.service?.horarioTermino}
                       </div>
                       <div className="flex items-center gap-1">
                          <Users className="w-2.5 h-2.5" />
                          {esc.policemenIds.length} Policiais
                       </div>
                    </div>
                    
                    <div className="flex flex-wrap items-center gap-2 mt-2 pt-1 border-t border-slate-100/50">
                       {esc.policemen && esc.policemen.length > 0 && (
                         <div className="flex items-center gap-1 text-[8px] font-black text-pmpe-navy bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100 flex-shrink-0">
                           <Crown className="w-2 h-2 text-amber-500" />
                           <span className="opacity-60">CMDT:</span>
                           {esc.policemen[0].nomeGuerra}
                         </div>
                       )}
                       {esc.policemen?.filter(p => p.isMotorista).map(p => (
                         <div key={p.id} className="flex items-center gap-1 text-[8px] font-black text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-100 flex-shrink-0">
                           <Car className="w-2 h-2 text-purple-500" />
                           <span className="opacity-60">MOT:</span>
                           {p.nomeGuerra}
                         </div>
                       ))}
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-4">
                  <div className="hidden sm:flex -space-x-1.5 items-center mr-2">
                    {esc.policemen?.slice(0, 3).map((p, i) => (
                      <div key={i} className="h-6 w-6 rounded-full border border-white bg-slate-100 flex items-center justify-center text-[8px] font-black text-slate-500 shadow-sm" title={p.nomeGuerra}>
                        {p.nomeGuerra.substring(0, 2).toUpperCase()}
                      </div>
                    ))}
                    {esc.policemenIds.length > 3 && (
                      <div className="h-6 w-6 rounded-full border border-white bg-pmpe-gold flex items-center justify-center text-[8px] font-black text-pmpe-navy shadow-sm">
                        +{esc.policemenIds.length - 3}
                      </div>
                    )}
                  </div>
                  
                  {isAdmin && !isSelectionMode && (
                    <button 
                      onClick={(e) => { e.stopPropagation(); handleDelete(esc.id!); }}
                      className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                      title="Excluir Rapidamente"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}

                  <ChevronDown className={cn("w-4 h-4 text-slate-300 transition-transform", expandedId === esc.id && "rotate-180")} />
                </div>
              </div>

              <AnimatePresence>
                {expandedId === esc.id && (
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: 'auto' }}
                    exit={{ height: 0 }}
                    className="bg-slate-50/50 border-t border-slate-100 overflow-hidden"
                  >
                    <div className="p-4 space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="md:col-span-2 space-y-2">
                             <h4 className="text-[9px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5 ml-1">
                                <Users className="w-3 h-3" /> Efetivo Escalado (Escalão/Hierarchy)
                             </h4>
                             <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {esc.policemen?.map((p, idx) => (
                                   <div key={p.id} className="flex items-center justify-between bg-white p-2.5 rounded-lg border border-slate-100 shadow-sm group">
                                      <div className="flex items-center gap-3">
                                         <div className={cn(
                                           "w-8 h-8 rounded-lg flex items-center justify-center text-[9px] font-black border transition-colors",
                                           idx === 0 ? "bg-pmpe-navy text-pmpe-gold border-pmpe-navy shadow-md" : "bg-slate-50 text-slate-400 border-slate-100"
                                         )}>
                                            {p.graduacaoPosto.substring(0, 2).toUpperCase()}
                                         </div>
                                         <div className="min-w-0">
                                            <div className="flex items-center gap-1.5">
                                              <p className={cn("text-[11px] font-black leading-tight truncate", idx === 0 ? "text-pmpe-navy" : "text-slate-800")}>{p.nomeGuerra}</p>
                                              {idx === 0 && <Crown className="w-2.5 h-2.5 text-amber-500" />}
                                              {p.isMotorista && <Car className="w-2.5 h-2.5 text-purple-500" />}
                                            </div>
                                            <p className="text-[8px] text-slate-400 font-bold uppercase tracking-tighter">{p.graduacaoPosto} | MAT: {p.matricula}</p>
                                         </div>
                                      </div>
                                      <div className="flex flex-col items-end gap-1">
                                         {idx === 0 && (
                                           <span className="bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-[4px] text-[7px] font-black uppercase tracking-widest shadow-xs">Comandante</span>
                                         )}
                                         {p.isMotorista && (
                                           <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-[4px] text-[7px] font-black uppercase tracking-widest shadow-xs">Motorista</span>
                                         )}
                                      </div>
                                   </div>
                                ))}
                             </div>
                        </div>
                        <div className="space-y-2">
                           <h4 className="text-[9px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5 ml-1">
                              <Info className="w-3 h-3" /> Observações
                           </h4>
                           <div className="bg-white p-3 rounded-lg border border-slate-100 min-h-[60px] text-[11px] text-slate-600 leading-normal italic shadow-xs">
                              {esc.observations || 'Nenhuma observação informada.'}
                           </div>
                           
                           <div className="pt-4 space-y-2">
                              <div className="flex items-center justify-between">
                                <h4 className="text-[9px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5 ml-1">
                                   <Share2 className="w-3 h-3" /> Operações
                                </h4>
                                {isAdmin && (
                                  <div className="flex items-center gap-2">
                                    <button 
                                      onClick={() => handleEdit(esc)}
                                      className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-all"
                                      title="Editar Escala"
                                    >
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                    <button 
                                      onClick={() => handleDelete(esc.id!)}
                                      className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                                      title="Excluir Escala"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button 
                                  onClick={() => exportToPDF(esc)}
                                  className="flex-1 min-w-[80px] flex items-center justify-center gap-2 px-3 py-2 bg-red-50 text-red-600 border border-red-100 rounded-lg text-[10px] font-black uppercase tracking-tight hover:bg-red-100 transition-all"
                                >
                                  <FileText className="w-3.5 h-3.5" />
                                  PDF
                                </button>
                                <button 
                                  onClick={() => exportToExcel(esc)}
                                  className="flex-1 min-w-[80px] flex items-center justify-center gap-2 px-3 py-2 bg-emerald-50 text-emerald-600 border border-emerald-100 rounded-lg text-[10px] font-black uppercase tracking-tight hover:bg-emerald-100 transition-all"
                                >
                                  <FileSpreadsheet className="w-3.5 h-3.5" />
                                  Excel
                                </button>
                                <button 
                                  onClick={() => shareWhatsApp(esc)}
                                  className="flex-1 min-w-[80px] flex items-center justify-center gap-2 px-3 py-2 bg-green-50 text-green-600 border border-green-100 rounded-lg text-[10px] font-black uppercase tracking-tight hover:bg-green-100 transition-all"
                                >
                                  <MessageCircle className="w-3.5 h-3.5" />
                                  WhatsApp
                                </button>
                              </div>
                           </div>

                           <p className="text-[8px] text-slate-400 font-black uppercase tracking-widest text-right mt-1 opacity-50">
                             ID: {esc.id?.substring(0, 8)}
                           </p>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))
        )}
      </div>
    )}

      <AnimatePresence>
        {isEditModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-pmpe-navy/40 backdrop-blur-sm"
              onClick={() => setIsEditModalOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-md rounded-2xl shadow-2xl relative z-[110] overflow-hidden border border-slate-200"
            >
              <div className="p-5 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-pmpe-navy flex items-center justify-center">
                    <Edit2 className="w-4 h-4 text-pmpe-gold" />
                  </div>
                  <div>
                    <h3 className="text-[11px] font-black text-slate-800 uppercase tracking-widest">Editar Escala</h3>
                    <p className="text-[9px] text-slate-400 font-bold uppercase tracking-tight leading-none">Alterar informações básicas</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsEditModalOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleUpdate} className="p-6 space-y-4">
                <div className="bg-amber-50 border border-amber-100 p-3 rounded-lg flex gap-3 items-start mb-4">
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-amber-700 leading-normal font-bold">
                    Ao alterar o serviço ou data, o efetivo escalado será mantido, mas verifique se os policiais ainda estão disponíveis.
                  </p>
                </div>

                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 ml-1">Data da Escala</label>
                  <input
                    type="date"
                    required
                    value={editFormData.date}
                    onChange={(e) => setEditFormData({...editFormData, date: e.target.value})}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pmpe-navy/5 focus:border-pmpe-navy transition-all"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 ml-1">Serviço/Modalidade</label>
                  <select
                    required
                    value={editFormData.serviceTypeId}
                    onChange={(e) => setEditFormData({...editFormData, serviceTypeId: e.target.value})}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pmpe-navy/5 focus:border-pmpe-navy transition-all appearance-none"
                  >
                    <option value="">Escolha um serviço...</option>
                    {services.map(s => (
                      <option key={s.id} value={s.id!}>{s.nome} ({s.tipo}) - {s.cidade}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 ml-1">Observações</label>
                  <textarea
                    rows={3}
                    value={editFormData.observations}
                    onChange={(e) => setEditFormData({...editFormData, observations: e.target.value})}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pmpe-navy/5 focus:border-pmpe-navy transition-all"
                    placeholder="Informações adicionais..."
                  />
                </div>

                <div className="pt-4 border-t border-slate-100 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setIsEditModalOpen(false)}
                    className="px-6 py-2 rounded-lg text-xs font-bold uppercase tracking-widest text-slate-500 hover:bg-slate-100 transition-all font-sans"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2 bg-pmpe-navy text-white rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-slate-800 transition-all shadow-sm flex items-center gap-2 font-sans"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Salvar Alterações</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      
      {/* HIDDEN REPORT VIEWS FOR HTML2CANVAS */}
      <div className="fixed -left-[4000px] top-0 pointer-events-none overflow-hidden">
          {/* OFFICIAL REPORT VIEW */}
          <div 
            ref={officialRef}
            className="bg-white p-8 text-black font-sans"
            style={{ width: '210mm' }}
          >
            {(() => {
              const reportScales = getReportScales();
              // Group scales by service to create one table per service
              const serviceIds = Array.from(new Set(reportScales.map(e => e.serviceTypeId)));
              
              if (serviceIds.length === 0) return <div className="text-center p-20 uppercase font-black opacity-20">Nenhuma escala para o período</div>;

              return serviceIds.map(sid => {
                const service = services.find(s => s.id === sid);
                const serviceScales = reportScales.filter(e => e.serviceTypeId === sid);
                const configDateObj = currentMonth;
                const monthDays = eachDayOfInterval({
                  start: startOfMonth(configDateObj),
                  end: endOfMonth(configDateObj)
                });

                // Prepare data for the table
                // If multiple people per day, we need multiple rows for that day
                const rows: any[] = [];
                monthDays.forEach(day => {
                  const dayScales = serviceScales.filter(e => isSameDay(e.date.toDate(), day));
                  const dayNum = parseInt(format(day, 'd'));
                  if (dayScales.length === 0) {
                    rows.push({ day: dayNum, pol: null });
                  } else {
                    dayScales.forEach(esc => {
                      esc.policemen?.forEach(p => {
                        rows.push({ day: dayNum, pol: p, esc });
                      });
                    });
                  }
                });

                const totalCotas = rows.reduce((acc, row) => acc + (row.pol ? 1 : 0), 0);

                return (
                  <div key={sid} className="mb-12 page-break-after-always official-report-table">
                    <div className="bg-[#f28c28] text-black font-black text-center py-1 border-2 border-black uppercase text-sm mb-0">
                      ESCALA {service?.nome} – 9ª CIPM – {format(configDateObj, 'MMMM yyyy', { locale: ptBR })}
                    </div>
                    <div className="bg-[#dcdcdc] text-black font-black text-center py-0.5 border-x-2 border-b-2 border-black uppercase text-[10px] mb-0">
                      LOCAL: {service?.cidade} – {service?.horarioInicio} AS {service?.horarioTermino}
                    </div>
                    <table className="w-full border-collapse border-b-2 border-black text-[9px]">
                      <thead>
                        <tr className="bg-white font-black uppercase text-center border-x-2 border-black">
                          <th className="border-r-2 border-black p-1 w-20">GRADUAÇÃO</th>
                          <th className="border-r-2 border-black p-1 w-20">MATRÍCULA</th>
                          <th className="border-r-2 border-black p-1">NOME DE GUERRA</th>
                          <th className="border-r-2 border-black p-1 w-20">OME</th>
                          <th className="border-r-2 border-black p-1 w-20">FUNÇÃO</th>
                          <th className="border-r-2 border-black p-1 w-10">DIAS</th>
                          <th className="border-r-2 border-black p-1 w-10">COTAS</th>
                          <th className="p-1 w-32">JORNADA</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, idx) => (
                          <tr 
                            key={idx} 
                            className={cn(
                              "border-x-2 border-b-2 border-black text-center h-5",
                              row.day % 2 === 0 ? "bg-[#e0f2fe]" : "bg-[#fee2e2]"
                            )}
                          >
                            <td className="border-r-2 border-black font-bold">{row.pol?.graduacaoPosto || '#N/D'}</td>
                            <td className="border-r-2 border-black font-bold">{row.pol?.matricula || '#N/D'}</td>
                            <td className="border-r-2 border-black font-bold text-left px-2 uppercase truncate max-w-[150px]">{row.pol?.nomeGuerra || ''}</td>
                            <td className="border-r-2 border-black font-bold">9ª CIPM</td>
                            <td className="border-r-2 border-black font-bold">{service?.categoria || 'P.O'}</td>
                            <td className="border-r-2 border-black font-black">{row.day}</td>
                            <td className="border-r-2 border-black font-black">{row.pol ? '1' : ''}</td>
                            <td className="font-bold text-[8px]">{service?.horarioInicio} as {service?.horarioTermino} (12h)</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-[#dcdcdc] font-black border-x-2 border-b-2 border-black">
                          <td colSpan={6} className="p-1 text-center border-r-2 border-black">TOTAL</td>
                          <td className="p-1 text-center">{totalCotas}</td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                );
              });
            })()}
          </div>
      </div>
      {/* Hidden high-res renderer for individual PDF export */}
      <div className="fixed top-[-9999px] left-[-9999px] pointer-events-none opacity-0">
        {scaleToPrint && (
          <div ref={printSingleRef} className="bg-white p-10 w-[950px] official-report-table">
            <div className="border-b-[4px] border-black pb-8 mb-8 flex items-center gap-12">
               <div className="w-28 h-28 flex-shrink-0">
                  <img 
                    src="https://upload.wikimedia.org/wikipedia/commons/thumb/c/c8/Bras%C3%A3o_da_PMPE.svg/1200px-Bras%C3%A3o_da_PMPE.svg.png" 
                    alt="PMPE" 
                    className="w-full h-full object-contain"
                    crossOrigin="anonymous"
                    referrerPolicy="no-referrer"
                  />
               </div>
               <div className="flex-1 text-center">
                  <h1 className="text-[24px] font-black text-black leading-tight uppercase tracking-tight mb-2">Polícia Militar de Pernambuco</h1>
                  <h2 className="text-[18px] font-bold text-black leading-tight uppercase mb-1">PM/DPO - Diretoria de Planejamento Operacional</h2>
                  <h3 className="text-[18px] font-bold text-black leading-tight uppercase">9ª CIPM - Companhia Independente da Polícia Militar</h3>
                  <p className="text-[14px] font-bold text-slate-500 uppercase mt-2 tracking-widest">(Araripina - Pernambuco)</p>
               </div>
               <div className="w-28 h-28 opacity-0">PMPE</div>
            </div>

            <div 
              className="text-white font-black text-center py-5 border-x-2 border-t-2 border-black uppercase text-lg shadow-inner relative overflow-hidden"
              style={{ backgroundColor: scaleToPrint.service?.color || '#1e293b' }}
            >
              ESCALA NOMINAL DO SERVIÇO: {scaleToPrint.service?.nome}
            </div>
            
            <div className="bg-slate-50 text-black font-black text-center py-4 border-2 border-black uppercase text-[12px] tracking-[0.3em] flex items-center justify-center gap-16">
              <span className="flex items-center gap-2"><MapPin className="w-5 h-5 text-pmpe-navy" /> LOCAL: {scaleToPrint.service?.cidade}</span>
              <span className="flex items-center gap-2"><Clock className="w-5 h-5 text-pmpe-navy" /> {format(scaleToPrint.date.toDate(), "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR })}</span>
              <span className="flex items-center gap-2"><Info className="w-5 h-5 text-pmpe-navy" /> {scaleToPrint.service?.horarioInicio} ÀS {scaleToPrint.service?.horarioTermino}</span>
            </div>

            <table className="w-full border-collapse border-b-2 border-black text-[14px]">
              <thead>
                <tr className="bg-slate-100 font-black uppercase text-center border-x-2 border-black border-b border-black">
                  <th className="border-r-2 border-black py-5 px-2 w-[15%]">GRADUAÇÃO</th>
                  <th className="border-r-2 border-black py-5 px-2 w-[15%]">MATRÍCULA</th>
                  <th className="border-r-2 border-black py-5 px-2">NOME DE GUERRA</th>
                  <th className="border-r-2 border-black py-5 px-2 w-[12%]">OME</th>
                  <th className="border-r-2 border-black py-5 px-2 w-[12%]">FUNÇÃO</th>
                </tr>
              </thead>
              <tbody>
                {scaleToPrint.policemen?.map((pol: any, idx: number) => (
                  <tr key={idx} className="border-x-2 border-b border-black/30 text-center font-mono">
                    <td className="border-r-2 border-black py-3 font-black">{pol.graduacaoPosto}</td>
                    <td className="border-r-2 border-black py-3 font-black">{pol.matricula}</td>
                    <td className="border-r-2 border-black py-3 font-black text-left px-8 uppercase text-pmpe-navy">{pol.nomeGuerra}</td>
                    <td className="border-r-2 border-black py-3 font-bold text-slate-500">9ª CIPM</td>
                    <td className="border-r-2 border-black py-3 font-black">
                      {idx === 0 ? 'CMDT' : pol.isMotorista ? 'MOT' : 'PATRUL.'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {scaleToPrint.observations && (
              <div className="mt-8 p-6 bg-slate-50 border-2 border-black rounded-lg">
                <p className="text-[11px] font-black uppercase mb-2 tracking-widest text-pmpe-navy">Observações Específicas do Serviço:</p>
                <p className="text-[14px] leading-relaxed text-slate-800 font-medium whitespace-pre-wrap">{scaleToPrint.observations}</p>
              </div>
            )}

            <div className="mt-24 grid grid-cols-2 gap-24 px-12 text-center">
               <div className="pt-12 border-t-2 border-black">
                  <p className="text-[14px] font-black uppercase text-black">Chefe da Seção de Planejamento (P/3)</p>
                  <p className="text-[12px] font-black text-slate-400">9ª CIPM - ARARIPINA-PE</p>
               </div>
               <div className="pt-12 border-t-2 border-black">
                  <p className="text-[14px] font-black uppercase text-black">Comandante da 9ª CIPM</p>
                  <p className="text-[12px] font-black text-slate-400">9ª CIPM - ARARIPINA-PE</p>
               </div>
            </div>

            <div className="mt-16 text-center text-[10px] font-black text-slate-300 uppercase tracking-[0.5em]">
               Policia Militar de Pernambuco - Valorizamos a Nossa Gente
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Escalas;
