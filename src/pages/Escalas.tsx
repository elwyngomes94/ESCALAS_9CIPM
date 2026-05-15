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
  // Report State
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [reportConfig, setReportConfig] = useState({
    mode: 'OFFICIAL' as 'SEI' | 'MATRIX' | 'OFFICIAL',
    scope: 'MONTH' as 'DAY' | 'MONTH' | 'FILTERED',
    serviceTypeId: '',
    date: format(new Date(), 'yyyy-MM-dd')
  });
  const [generatingReport, setGeneratingReport] = useState(false);
  
  const reportRef = useRef<HTMLDivElement>(null);
  const matrixRef = useRef<HTMLDivElement>(null);
  const officialRef = useRef<HTMLDivElement>(null);

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

  const fetchData = async () => {
    setLoading(true);
    try {
      const eQ = query(collection(db, 'escalas'), orderBy('date', 'desc'));
      const eSnap = await getDocs(eQ);
      
      const sSnap = await getDocs(collection(db, 'serviceTypes'));
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
  }, []);

  const exportToPDF = (esc: any) => {
    const doc = new jsPDF();
    const dateStr = format(esc.date.toDate(), 'dd/MM/yyyy');
    
    doc.setFontSize(16);
    doc.text(`Escala de Serviço - ${esc.service?.nome}`, 14, 20);
    
    doc.setFontSize(10);
    doc.text(`Data: ${dateStr}`, 14, 30);
    doc.text(`Local: ${esc.service?.cidade}`, 14, 35);
    doc.text(`Horário: ${esc.service?.horarioInicio} - ${esc.service?.horarioTermino}`, 14, 40);
    
    const tableData = esc.policemen.map((p: any, idx: number) => {
      let role = idx === 0 ? 'Comandante' : 'Patrulheiro';
      if (p.isMotorista) role = 'Motorista';
      return [
        p.graduacaoPosto,
        p.nomeGuerra,
        p.matricula,
        role,
        p.telefone
      ];
    });

    autoTable(doc, {
      startY: 50,
      head: [['Posto/Grad', 'Nome de Guerra', 'Matrícula', 'Função', 'Telefone']],
      body: tableData,
    });

    if (esc.observations) {
      const finalY = (doc as any).lastAutoTable.finalY + 10;
      doc.text('Observações:', 14, finalY);
      doc.setFontSize(8);
      doc.text(esc.observations, 14, finalY + 5, { maxWidth: 180 });
    }

    doc.save(`escala_${esc.service?.nome}_${dateStr}.pdf`);
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
      message += `${i + 1}. ${p.graduacaoPosto} ${p.nomeGuerra} (${p.matricula})\n`;
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
    return escalas.filter(esc => {
      const escDate = esc.date.toDate();
      const escDateStr = format(escDate, 'yyyy-MM-dd');
      const configDateObj = new Date(reportConfig.date.length === 7 ? reportConfig.date + '-01' : reportConfig.date);
      
      if (reportConfig.scope === 'DAY') {
        const configDateStr = format(configDateObj, 'yyyy-MM-dd');
        return escDateStr === configDateStr;
      }
      if (reportConfig.scope === 'MONTH') {
        return format(escDate, 'yyyy-MM') === format(configDateObj, 'yyyy-MM');
      }
      if (reportConfig.scope === 'FILTERED') {
        const matchesDate = filterDate ? escDateStr === filterDate : true;
        const matchesCity = filterCity ? esc.service?.cidade.toLowerCase().includes(filterCity.toLowerCase()) : true;
        const matchesType = filterType ? esc.service?.tipo === filterType : true;
        const matchesPolice = filterPolice ? esc.policemen?.some(p => p.nomeGuerra.toLowerCase().includes(filterPolice.toLowerCase())) : true;
        return matchesDate && matchesCity && matchesType && matchesPolice;
      }
      return true;
    }).filter(esc => reportConfig.serviceTypeId ? esc.serviceTypeId === reportConfig.serviceTypeId : true);
  };

  const exportBatchExcel = () => {
    const reportScales = getReportScales();
    if (reportScales.length === 0) return alert('Nenhuma escala para exportar.');

    const configDateObj = new Date(reportConfig.date.length === 7 ? reportConfig.date + '-01' : reportConfig.date);

    if (reportConfig.mode === 'SEI') {
      const data = reportScales.flatMap(esc => 
        esc.policemen?.map(p => ({
          'Posto/Graduação': p.graduacaoPosto,
          'Matrícula': p.matricula,
          'Nome de Guerra': p.nomeGuerra,
          'OME': '9ª CIPM',
          'Função': p.isMotorista ? 'Motorista' : (esc.policemenIds[0] === p.id ? 'Comandante' : 'Patrulheiro'),
          'Dia': getDate(esc.date.toDate()),
          'Cotas': 1,
          'Jornada': `${esc.service?.horarioInicio} às ${esc.service?.horarioTermino}`,
          'Serviço': esc.service?.nome
        }))
      );
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Escalas");
      XLSX.writeFile(wb, `Relatorio_Escalas_${reportConfig.scope}_${format(configDateObj, 'yyyy-MM-dd')}.xlsx`);
    } else {
      // Matrix Excel
      const pSnap = escalas.flatMap(e => e.policemen || []);
      const uniqueP = Array.from(new Set(pSnap.map(p => p.id))).map(id => pSnap.find(p => p.id === id)!);
      
      const days = eachDayOfInterval({
        start: startOfMonth(configDateObj),
        end: endOfMonth(configDateObj)
      });

      const rows = uniqueP.map(p => {
        const row: any = { 'Policial': `${p.graduacaoPosto} ${p.nomeGuerra}` };
        days.forEach(day => {
          const d = getDate(day);
          const found = reportScales.find(e => isSameDay(e.date.toDate(), day) && e.policemenIds.includes(p.id!));
          row[d] = found ? found.service?.nome : '';
        });
        return row;
      });

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Mapa Mensal");
      XLSX.writeFile(wb, `Mapa_Mensal_${format(configDateObj, 'yyyy-MM')}.xlsx`);
    }
  };

  const exportBatchPDF = async () => {
    if (reportConfig.mode !== 'OFFICIAL') {
      const targetRef = reportConfig.mode === 'SEI' ? reportRef : matrixRef;
      if (!targetRef.current) return;
      
      setGeneratingReport(true);
      try {
        const canvas = await html2canvas(targetRef.current, {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: '#ffffff'
        });
        
        const imgData = canvas.toDataURL('image/png');
        const pdf = new jsPDF(reportConfig.mode === 'MATRIX' ? 'l' : 'p', 'mm', 'a4');
        const pageWidth = pdf.internal.pageSize.getWidth();
        const imgWidth = pageWidth;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        
        pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);
        pdf.save(`Relatorio_${reportConfig.mode}_${reportConfig.date}.pdf`);
      } catch (err) {
        console.error(err);
        alert('Erro ao gerar PDF');
      } finally {
        setGeneratingReport(false);
      }
      return;
    }

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

      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();

      for (let i = 0; i < tables.length; i++) {
        const table = tables[i] as HTMLElement;
        const canvas = await html2canvas(table, {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: '#ffffff'
        });

        const imgData = canvas.toDataURL('image/png');
        const imgWidth = pageWidth - 20; // Margin
        const imgHeight = (canvas.height * imgWidth) / canvas.width;

        if (i > 0) pdf.addPage();
        pdf.addImage(imgData, 'PNG', 10, 10, imgWidth, imgHeight);
      }

      pdf.save(`Escalas_Oficiais_${reportConfig.date}.pdf`);
    } catch (err) {
      console.error(err);
      alert('Erro ao gerar PDF');
    } finally {
      setGeneratingReport(false);
    }
  };

  const shareBatchWhatsApp = () => {
    const reportScales = getReportScales();
    if (reportScales.length === 0) return alert('Nenhuma escala para compartilhar.');

    let message = `*RELATÓRIO DE ESCALAS - 9ª CIPM*\n`;
    message += `*Escopo:* ${reportConfig.scope}\n`;
    message += `*Referência:* ${reportConfig.date}\n`;
    message += `----------------------------\n\n`;

    reportScales.forEach((esc, idx) => {
      message += `*${idx + 1}. ${esc.service?.nome}*\n`;
      message += `📅 ${format(esc.date.toDate(), 'dd/MM/yyyy')} | ⏰ ${esc.service?.horarioInicio}-${esc.service?.horarioTermino}\n`;
      message += `📍 ${esc.service?.cidade}\n`;
      message += `👥 *EFETIVO:*\n`;
      esc.policemen?.forEach(p => {
        message += ` - ${p.graduacaoPosto} ${p.nomeGuerra}\n`;
      });
      message += `\n`;
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
                <button
                  id="open-report-modal-btn"
                  onClick={() => setIsReportModalOpen(true)}
                  className="px-3 py-1.5 text-[9px] font-black text-white uppercase tracking-widest bg-pmpe-navy rounded-lg shadow-sm hover:bg-slate-800 transition-all flex items-center gap-2"
                >
                  <FileText className="w-3.5 h-3.5 text-pmpe-gold" />
                  Gerar Relatórios
                </button>
                {viewMode === 'official' && (
                  <button
                    onClick={() => {
                      setReportConfig({
                        ...reportConfig,
                        mode: 'OFFICIAL',
                        scope: 'MONTH',
                        date: format(currentMonth, 'yyyy-MM')
                      });
                      setTimeout(exportBatchPDF, 100);
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
        <div className="space-y-8 bg-slate-50 p-6 rounded-xl border border-slate-200 shadow-inner">
           <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                 <Filter className="w-4 h-4 text-slate-400" />
                 <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Filtrar Serviço Para Visualização:</span>
              </div>
              <select 
                value={selectedServiceId}
                onChange={(e) => setSelectedServiceId(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-md px-3 py-1.5 text-xs font-bold text-pmpe-navy outline-none focus:ring-1 focus:ring-pmpe-navy"
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
                <div className="text-center py-20 bg-white rounded-xl border border-dashed border-slate-200">
                  <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Nenhum serviço configurado para este mês</p>
                </div>
              );

              return filteredServices.map(service => {
                const serviceScales = escalas.filter(e => 
                  e.serviceTypeId === service.id && 
                  e.date.toDate() >= monthStart && e.date.toDate() <= monthEnd
                );
                
                const monthDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
                const rows: any[] = [];
                monthDays.forEach(day => {
                  const dayScales = serviceScales.filter(e => isSameDay(e.date.toDate(), day));
                  if (dayScales.length === 0) {
                    rows.push({ day: getDate(day), pol: null });
                  } else {
                    dayScales.forEach(esc => {
                      esc.policemen?.forEach(p => {
                        rows.push({ day: getDate(day), pol: p, esc });
                      });
                    });
                  }
                });

                const totalCotasValue = rows.reduce((acc, row) => acc + (row.pol ? 1 : 0), 0);

                return (
                  <div key={service.id} className="bg-white p-1 shadow-xl border border-slate-300 rounded overflow-x-auto">
                    <div className="min-w-[800px]">
                        <div className="bg-[#f28c28] text-black font-black text-center py-2 border-2 border-black uppercase text-xs">
                          ESCALA {service.nome} – 9ª CIPM – {format(currentMonth, 'MMMM yyyy', { locale: ptBR })}
                        </div>
                        <div className="bg-[#dcdcdc] text-black font-black text-center py-1 border-x-2 border-b-2 border-black uppercase text-[9px]">
                          LOCAL: {service.cidade} – {service.horarioInicio} AS {service.horarioTermino}
                        </div>
                        <table className="w-full border-collapse border-b-2 border-black text-[10px]">
                          <thead>
                            <tr className="bg-white font-black uppercase text-center border-x-2 border-black">
                              <th className="border-r-2 border-black p-1 w-[12%]">GRADUAÇÃO</th>
                              <th className="border-r-2 border-black p-1 w-[12%]">MATRÍCULA</th>
                              <th className="border-r-2 border-black p-1">NOME DE GUERRA</th>
                              <th className="border-r-2 border-black p-1 w-[10%]">OME</th>
                              <th className="border-r-2 border-black p-1 w-[10%]">FUNÇÃO</th>
                              <th className="border-r-2 border-black p-1 w-[5%]">DIAS</th>
                              <th className="border-r-2 border-black p-1 w-[5%]">COTAS</th>
                              <th className="p-1 w-[15%]">JORNADA</th>
                            </tr>
                          </thead>
                          <tbody>
                        {rows.map((row, idx) => (
                          <tr 
                            key={idx} 
                            className={cn(
                              "border-x-2 border-b-2 border-black text-center group transition-colors",
                              row.day % 2 === 0 ? "bg-blue-50/40" : "bg-red-50/40"
                            )}
                          >
                            <td className="border-r-2 border-black py-0.5 font-bold">{row.pol?.graduacaoPosto || '#N/D'}</td>
                            <td className="border-r-2 border-black py-0.5 font-bold">{row.pol?.matricula || '#N/D'}</td>
                            <td className="border-r-2 border-black py-0.5 font-bold text-left px-2 uppercase">{row.pol?.nomeGuerra || ''}</td>
                            <td className="border-r-2 border-black py-0.5 font-bold">9ª CIPM</td>
                            <td className="border-r-2 border-black py-0.5 font-bold">{service.categoria || 'P.O'}</td>
                            <td className="border-r-2 border-black py-0.5 font-black">{row.day}</td>
                            <td className="border-r-2 border-black py-0.5 font-black">{row.pol ? '1' : ''}</td>
                            <td className="font-bold py-0.5">{service.horarioInicio} as {service.horarioTermino} (12h)</td>
                          </tr>
                        ))}
                          </tbody>
                          <tfoot>
                            <tr className="bg-[#dcdcdc] font-black border-x-2 border-b-2 border-black h-8">
                              <td colSpan={6} className="p-1 text-center border-r-2 border-black uppercase">TOTAL</td>
                              <td className="p-1 text-center bg-white border-r-2 border-black">{totalCotasValue}</td>
                              <td className="bg-white"></td>
                            </tr>
                          </tfoot>
                        </table>
                    </div>
                  </div>
                );
              });
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
      
      {/* REPORT GENERATOR MODAL */}
      <AnimatePresence>
        {isReportModalOpen && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
              onClick={() => !generatingReport && setIsReportModalOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl relative z-[130] overflow-hidden border border-slate-200"
            >
              {/* Modal Header */}
              <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-pmpe-navy flex items-center justify-center shadow-lg shadow-pmpe-navy/20">
                    <ClipboardList className="w-6 h-6 text-pmpe-gold" />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-slate-800 uppercase tracking-tighter">Gerador de Relatórios Estruturados</h3>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-none mt-1">Exportação oficial e monitoramento mensal</p>
                  </div>
                </div>
                {!generatingReport && (
                  <button 
                    onClick={() => setIsReportModalOpen(false)}
                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
                  >
                    <X className="w-6 h-6" />
                  </button>
                )}
              </div>

              <div className="p-8 grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Configuration side */}
                <div className="space-y-6">
                  <div className="space-y-4">
                    <h4 className="text-[10px] font-black uppercase text-pmpe-navy tracking-[0.2em] flex items-center gap-2">
                       <LayoutGrid className="w-3 h-3" /> Configurações do Relatório
                    </h4>
                    
                    <div className="space-y-4">
                      <div>
                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">Modelo de Visualização</label>
                        <div id="report-mode-selector" className="flex gap-2 p-1 bg-slate-100 rounded-xl">
                          <button 
                            id="report-mode-official-btn"
                            onClick={() => setReportConfig({...reportConfig, mode: 'OFFICIAL'})}
                            className={cn(
                              "flex-1 px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                              reportConfig.mode === 'OFFICIAL' ? "bg-white text-pmpe-navy shadow-sm" : "text-slate-400"
                            )}
                          >
                            Modelo Oficial
                          </button>
                          <button 
                            id="report-mode-sei-btn"
                            onClick={() => setReportConfig({...reportConfig, mode: 'SEI'})}
                            className={cn(
                              "flex-1 px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                              reportConfig.mode === 'SEI' ? "bg-white text-pmpe-navy shadow-sm" : "text-slate-400"
                            )}
                          >
                            Padrão SEI
                          </button>
                          <button 
                            id="report-mode-matrix-btn"
                            onClick={() => setReportConfig({...reportConfig, mode: 'MATRIX'})}
                            className={cn(
                              "flex-1 px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                              reportConfig.mode === 'MATRIX' ? "bg-white text-pmpe-navy shadow-sm" : "text-slate-400"
                            )}
                          >
                            Mapa Mensal
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">Escopo do Relatório</label>
                        <div id="report-scope-selector" className="grid grid-cols-3 gap-2">
                          {(['DAY', 'MONTH', 'FILTERED'] as const).map(s => (
                            <button
                              key={s}
                              id={`report-scope-${s.toLowerCase()}-btn`}
                              onClick={() => setReportConfig({...reportConfig, scope: s})}
                              className={cn(
                                "px-3 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest border transition-all",
                                reportConfig.scope === s 
                                  ? "bg-pmpe-navy text-white border-pmpe-navy shadow-md" 
                                  : "bg-white text-slate-400 border-slate-100 hover:border-slate-200"
                              )}
                            >
                              {s === 'DAY' ? 'Diário' : s === 'MONTH' ? 'Mensal' : 'Filtro Atual'}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        {reportConfig.scope !== 'FILTERED' && (
                          <div className={cn(reportConfig.scope === 'MONTH' ? "col-span-2" : "")}>
                            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">
                              {reportConfig.scope === 'DAY' ? 'Data de Referência' : 'Mês de Referência'}
                            </label>
                            <input
                              id="report-date-input"
                              type={reportConfig.scope === 'DAY' ? "date" : "month"}
                              value={reportConfig.scope === 'MONTH' && reportConfig.date.length > 7 ? reportConfig.date.substring(0, 7) : reportConfig.date}
                              onChange={(e) => setReportConfig({...reportConfig, date: e.target.value})}
                              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-1 focus:ring-pmpe-navy outline-none"
                            />
                          </div>
                        )}
                        {reportConfig.mode === 'SEI' && (
                          <div className={cn(reportConfig.scope === 'FILTERED' ? "col-span-2" : "")}>
                            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">Tipo de Serviço</label>
                            <select
                              value={reportConfig.serviceTypeId}
                              onChange={(e) => setReportConfig({...reportConfig, serviceTypeId: e.target.value})}
                              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-1 focus:ring-pmpe-navy outline-none"
                            >
                              <option value="">TODOS OS SERVIÇOS</option>
                              {services.map(s => (
                                <option key={s.id} value={s.id!}>{s.nome} - {s.tipo}</option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="pt-6 border-t border-slate-100 space-y-4">
                     <h4 className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Ações de Exportação</h4>
                     <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <button 
                          onClick={exportBatchPDF}
                          disabled={generatingReport}
                          className="flex items-center justify-center gap-2 px-4 py-3 bg-red-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-red-700 transition-all shadow-lg shadow-red-600/20 disabled:opacity-50"
                        >
                          {generatingReport ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Download className="w-4 h-4" />}
                          PDF
                        </button>
                        <button 
                          onClick={exportBatchExcel}
                          disabled={generatingReport}
                          className="flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-600/20 disabled:opacity-50"
                        >
                          <FileSpreadsheet className="w-4 h-4" />
                          Excel
                        </button>
                        <button 
                          onClick={shareBatchWhatsApp}
                          disabled={generatingReport}
                          className="flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-green-700 transition-all shadow-lg shadow-green-600/20 disabled:opacity-50"
                        >
                          <MessageCircle className="w-4 h-4" />
                          WhatsApp
                        </button>
                     </div>
                  </div>
                </div>

                {/* Preview / Info side */}
                <div className="bg-slate-50 p-6 rounded-3xl border border-slate-200/50 flex flex-col justify-between">
                   <div className="space-y-4">
                      <div className="flex items-center justify-between">
                         <h4 className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em]">Resumo do Relatório</h4>
                         <span className="px-2 py-1 bg-pmpe-navy text-pmpe-gold text-[8px] font-black uppercase rounded shadow-sm">
                           {getReportScales().length} Escalas Encontradas
                         </span>
                      </div>
                      
                      <div className="space-y-2">
                         {getReportScales().slice(0, 5).map(esc => (
                           <div key={esc.id} className="flex items-center justify-between bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                              <div className="flex items-center gap-3">
                                 <div className="text-[9px] font-black text-pmpe-navy opacity-50">{format(esc.date.toDate(), 'dd/MM')}</div>
                                 <div className="text-[11px] font-bold text-slate-700">{esc.service?.nome}</div>
                              </div>
                              <div className="text-[10px] font-black text-slate-400">{esc.policemenIds.length} Ativos</div>
                           </div>
                         ))}
                         {getReportScales().length > 5 && (
                           <p className="text-center text-[10px] font-bold text-slate-400 uppercase italic">+ {getReportScales().length - 5} outras escalas...</p>
                         )}
                         {getReportScales().length === 0 && (
                           <div className="py-20 flex flex-col items-center gap-2 opacity-30">
                              <AlertTriangle className="w-8 h-8" />
                              <p className="text-[10px] font-black uppercase">Nenhuma escala no período</p>
                           </div>
                         )}
                      </div>
                   </div>

                   <div className="bg-pmpe-navy p-4 rounded-2xl text-white space-y-2">
                      <div className="flex items-center gap-2 text-pmpe-gold">
                         <Info className="w-4 h-4" />
                         <span className="text-[10px] font-black uppercase tracking-widest">Informação Importante</span>
                      </div>
                      <p className="text-[11px] text-white/70 leading-relaxed font-medium">
                        O modelo **SEI** gera o formato oficial de diário para upload no sistema governamental. O modelo **MAPA** fornece a visão estratégica horizontal de todo o mês.
                      </p>
                   </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* HIDDEN REPORT VIEWS FOR HTML2CANVAS */}
      <div className="fixed -left-[4000px] top-0 pointer-events-none overflow-hidden">
         {/* SEI REPORT VIEW */}
         <div 
            ref={reportRef}
            className="bg-white p-[15mm] text-black font-serif"
            style={{ width: '210mm', minHeight: '297mm' }}
          >
            <div className="flex flex-col items-center mb-8">
              <div className="flex gap-8 items-center mb-4">
                <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/Brasao_PMPE.png/200px-Brasao_PMPE.png" alt="PMPE" className="h-16" />
                <div className="text-center">
                  <p className="text-[10px] font-bold uppercase">Secretaria de Defesa Social</p>
                  <p className="text-lg font-bold text-blue-800 italic uppercase">Pernambuco</p>
                  <p className="text-[10px] font-bold uppercase tracking-widest">Governo do Estado</p>
                </div>
              </div>
              <h3 className="text-sm font-bold uppercase tracking-tight mb-2">Polícia Militar de Pernambuco</h3>
              <p className="text-[10px] font-bold uppercase mb-4">ESCALA DE SERVIÇO nº {Math.floor(Math.random() * 100) + 1} – PMPE - 9CIPM-P1</p>
              <h2 className="text-sm font-black uppercase mb-1 underline">ESCALA DE SERVIÇO - {reportConfig.date}</h2>
            </div>

            <table className="w-full border-collapse border border-slate-300 text-[9px]">
              <thead>
                <tr className="bg-slate-50 font-bold uppercase text-[7px]">
                  <th className="border border-slate-300 p-1">Graduação</th>
                  <th className="border border-slate-300 p-1">Matrícula</th>
                  <th className="border border-slate-300 p-1">Nome de Guerra</th>
                  <th className="border border-slate-300 p-1">Função</th>
                  <th className="border border-slate-300 p-1">Dia</th>
                  <th className="border border-slate-300 p-1">Jornada</th>
                  <th className="border border-slate-300 p-1">Serviço</th>
                </tr>
              </thead>
              <tbody>
                {getReportScales().map((esc) => (
                  <React.Fragment key={esc.id}>
                    {esc.policemen?.map((p, pIdx) => (
                      <tr key={`${esc.id}-${p.id}`}>
                        <td className="border border-slate-300 p-1 text-center">{p.graduacaoPosto}</td>
                        <td className="border border-slate-300 p-1 text-center">{p.matricula}</td>
                        <td className="border border-slate-300 p-1 px-2">{p.nomeGuerra}</td>
                        <td className="border border-slate-300 p-1 text-center uppercase">
                          {pIdx === 0 ? 'Comandante' : (p.isMotorista ? 'Motorista' : 'Patrulheiro')}
                        </td>
                        <td className="border border-slate-300 p-1 text-center">{getDate(esc.date.toDate())}</td>
                        <td className="border border-slate-300 p-1 text-center">{esc.service?.horarioInicio} às {esc.service?.horarioTermino}</td>
                        <td className="border border-slate-300 p-1 text-center">{esc.service?.nome}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* MATRIX REPORT VIEW */}
          <div 
            ref={matrixRef}
            className="bg-white p-8 text-black"
            style={{ width: '297mm', minHeight: '210mm' }}
          >
            <div className="text-center mb-8 border-b-2 border-pmpe-navy pb-6">
              <h2 className="text-2xl font-black text-pmpe-navy uppercase tracking-tight">Mapa de Distribuição Operacional</h2>
              <p className="text-sm font-bold text-slate-500 uppercase tracking-[0.3em]">{reportConfig.date}</p>
            </div>
            <table className="w-full border-collapse">
               <thead>
                 <tr>
                    <th className="border-2 border-slate-800 p-2 bg-slate-800 text-white text-[10px] uppercase font-black min-w-[150px]">Policial</th>
                    {eachDayOfInterval({
                      start: startOfMonth(new Date(reportConfig.date.length === 7 ? reportConfig.date + '-01' : reportConfig.date)),
                      end: endOfMonth(new Date(reportConfig.date.length === 7 ? reportConfig.date + '-01' : reportConfig.date))
                    }).map(day => (
                      <th key={day.toISOString()} className="border-2 border-slate-300 p-1 w-8 text-[9px] font-black uppercase bg-slate-50">
                        {getDate(day)}
                      </th>
                    ))}
                 </tr>
               </thead>
               <tbody>
                  {Array.from(new Set(getReportScales().flatMap(e => e.policemenIds))).map(pid => {
                    const poly = escalas.flatMap(e => e.policemen || []).find(p => p.id === pid);
                    if (!poly) return null;
                    return (
                      <tr key={pid}>
                         <td className="border-2 border-slate-300 p-2 text-[10px] font-bold">{poly.graduacaoPosto} {poly.nomeGuerra}</td>
                         {eachDayOfInterval({
                            start: startOfMonth(new Date(reportConfig.date.length === 7 ? reportConfig.date + '-01' : reportConfig.date)),
                            end: endOfMonth(new Date(reportConfig.date.length === 7 ? reportConfig.date + '-01' : reportConfig.date))
                          }).map(day => {
                            const esc = getReportScales().find(e => isSameDay(e.date.toDate(), day) && e.policemenIds.includes(pid));
                            return (
                              <td key={day.toISOString()} className={cn("border-2 border-slate-300 p-0 text-center h-8", esc ? "bg-pmpe-navy/10" : "")}>
                                {esc && <span className="text-[7px] font-black text-pmpe-navy">{esc.service?.tipo === 'PJES' ? 'P' : 'O'}</span>}
                              </td>
                            );
                          })}
                      </tr>
                    );
                  })}
               </tbody>
            </table>
          </div>
          
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
                const configDateObj = new Date(reportConfig.date.length === 7 ? reportConfig.date + '-01' : reportConfig.date);
                const monthDays = eachDayOfInterval({
                  start: startOfMonth(configDateObj),
                  end: endOfMonth(configDateObj)
                });

                // Prepare data for the table
                // If multiple people per day, we need multiple rows for that day
                const rows: any[] = [];
                monthDays.forEach(day => {
                  const dayScales = serviceScales.filter(e => isSameDay(e.date.toDate(), day));
                  if (dayScales.length === 0) {
                    rows.push({ day: getDate(day), pol: null });
                  } else {
                    dayScales.forEach(esc => {
                      esc.policemen?.forEach(p => {
                        rows.push({ day: getDate(day), pol: p, esc });
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
    </div>
  );
};

export default Escalas;
