import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  getDocs, 
  addDoc, 
  doc,
  onSnapshot,
  query, 
  where,
  serverTimestamp,
  Timestamp,
  deleteDoc,
  updateDoc
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { Policeman, ServiceType, Volunteer, Escala, QuotaSettings, QuotaLog, OrdinarySchedule } from '../types';
import { OperationType, handleFirestoreError, cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { 
  X, 
  Search, 
  Users,
  AlertCircle,
  Clock,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Download,
  ShieldCheck,
  CheckCircle2,
  BarChart3,
  Target,
  ArrowRight,
  Check,
  Zap,
  Shield,
  FileSpreadsheet
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  eachDayOfInterval, 
  getDate, 
  isSameDay, 
  addMonths,
  subMonths,
  isWeekend,
  isToday
} from 'date-fns';
import { ptBR } from 'date-fns/locale';

const CreateEscala = () => {
  const { isAdmin } = useAuth();
  const [services, setServices] = useState<ServiceType[]>([]);
  const [volunteers, setVolunteers] = useState<(Volunteer & { policeman?: Policeman })[]>([]);
  const [allEscalasOfMonth, setAllEscalasOfMonth] = useState<(Escala & { service?: ServiceType })[]>([]);
  const [policemen, setPolicemen] = useState<Record<string, Policeman>>({});
  const [ordinarySchedules, setOrdinarySchedules] = useState<Record<string, number[]>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [success, setSuccess] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'PJES' | 'OPS'>('PJES');

  const mKey = format(currentMonth, 'yyyy-MM');
  const prevMonthKey = format(subMonths(currentMonth, 1), 'yyyy-MM');

  const [serviceSearchTerm, setServiceSearchTerm] = useState('');
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [unitQuotas, setUnitQuotas] = useState<QuotaSettings | null>(null);
  const [currentUsage, setCurrentUsage] = useState({ PJES_MP: 0, PJES_FORUM: 0, PJES_ESCOLAR: 0, PJES_DECRETO: 0, OPS: 0 });
  const [serviceSpecificUsage, setServiceSpecificUsage] = useState<Record<string, number>>({});
  const [assignmentModal, setAssignmentModal] = useState<{
    policemanId: string;
    policemanName: string;
    policemanMat: string;
    date: Date;
  } | null>(null);

  const handleDuplicateLastMonth = async () => {
    if (!isAdmin || duplicating) return;
    if (!window.confirm(`Deseja duplicar todas as CONFIGURAÇÕES DE SERVIÇO de ${format(subMonths(currentMonth, 1), 'MMMM', { locale: ptBR })} para este mês?`)) return;

    setDuplicating(true);
    try {
      // 1. Get service types from prev month
      const prevServicesSnap = await getDocs(query(collection(db, 'serviceTypes'), where('month', '==', prevMonthKey)));
      
      // 2. Add them to current month
      for (const d of prevServicesSnap.docs) {
        const data = d.data();
        await addDoc(collection(db, 'serviceTypes'), {
          ...data,
          month: mKey,
          createdAt: serverTimestamp(),
          activeDates: [] // Reset active dates for the new month to avoid confusion
        });
      }

      // 3. Duplicate Quota Settings
      const prevQuotasSnap = await getDocs(query(collection(db, 'quotaSettings'), where('month', '==', prevMonthKey)));
      if (!prevQuotasSnap.empty) {
        const qData = prevQuotasSnap.docs[0].data();
        await addDoc(collection(db, 'quotaSettings'), {
          ...qData,
          month: mKey,
          updatedAt: serverTimestamp()
        });
      }

      alert('Configurações duplicadas com sucesso!');
      window.location.reload();
    } catch (err) {
      console.error(err);
      alert('Erro ao duplicar: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setDuplicating(false);
    }
  };

  const suggestBestPM = (date: Date) => {
    if (!selectedServiceId) return;
    const service = services.find(s => s.id === selectedServiceId);
    if (!service) return;

    const dateStr = format(date, 'yyyy-MM-dd');
    const dayNum = getDate(date);

    // Candidates are those who volunteered for this tab type
    const candidates = filteredVolunteers.filter(v => {
      const poly = v.policeman;
      if (!poly) return false;

      // Filter by availability (not ordinary)
      const isOrd = (ordinarySchedules[v.policemanId] || []).includes(dayNum);
      if (isOrd) return false;

      // Check if already scaled in THIS service type today
      const alreadyScaled = joinedEscalas.some(e => 
        format(e.date.toDate(), 'yyyy-MM-dd') === dateStr && 
        e.policemenIds.includes(v.policemanId) &&
        e.service?.tipo === service.tipo
      );
      if (alreadyScaled && service.tipo === 'PJES') return false;

      // Check remaining quotas
      const scaledCount = joinedEscalas.filter(e => 
        e.policemenIds.includes(v.policemanId) && 
        e.service?.tipo === service.tipo
      ).length;
      if (scaledCount >= (v.cotas || 0) && service.tipo === 'PJES') return false;

      return true;
    });

    // Sort by Seniority (Antiguidade - lower is better in military logic: 1 is top)
    candidates.sort((a, b) => {
      const antA = a.policeman?.antiguidade || 9999;
      const antB = b.policeman?.antiguidade || 9999;
      return antA - antB;
    });

    if (candidates.length > 0) {
      const best = candidates[0];
      if (window.confirm(`Sugerimos: ${best.policeman?.graduacaoPosto} ${best.policeman?.nomeGuerra} (Mais Antigo Disponível). Deseja escalar?`)) {
        handleAssignService(selectedServiceId, { policemanId: best.policemanId, date });
      }
    } else {
      alert('Nenhum policial disponível seguindo as regras para esta data.');
    }
  };

  // Joins computed via useMemo to avoid stale data in closures and redundant state
  const joinedVolunteers = useMemo(() => {
    return volunteers.map(v => ({
      ...v,
      policeman: policemen[v.policemanId]
    }));
  }, [volunteers, policemen]);

  const joinedEscalas = useMemo(() => {
    return allEscalasOfMonth.map(e => ({
      ...e,
      service: services.find(s => s.id === e.serviceTypeId)
    }));
  }, [allEscalasOfMonth, services]);

  useEffect(() => {
    // 1. Initial Static Data (Services, Policemen, Quotas)
    const loadStaticData = async () => {
      try {
        const [sSnap, polySnap, settingsSnap, ordSnap] = await Promise.all([
          getDocs(query(collection(db, 'serviceTypes'), where('month', '==', mKey))),
          getDocs(collection(db, 'policemen')),
          getDocs(query(collection(db, 'quotaSettings'), where('month', '==', mKey))),
          getDocs(query(collection(db, 'ordinarySchedules'), where('month', '==', mKey)))
        ]);

        const sData = sSnap.docs.map(d => ({
          id: d.id,
          ...d.data(),
          activationType: d.data().activationType || 'ALL',
          activeDates: d.data().activeDates || [],
          month: d.data().month || mKey,
          cotasPorServico: d.data().cotasPorServico ?? d.data().cotasPorEscala ?? 1
        } as ServiceType));
        setServices(sData);

        const polyData = polySnap.docs.reduce((acc, d) => {
          acc[d.id] = { id: d.id, ...d.data() } as Policeman;
          return acc;
        }, {} as Record<string, Policeman>);
        setPolicemen(polyData);

        let qSettings: QuotaSettings = { month: mKey, pjesMPTotal: 0, pjesForumTotal: 0, pjesEscolarTotal: 0, pjesDecretoTotal: 0, opsTotal: 0 };
        if (!settingsSnap.empty) {
          qSettings = { id: settingsSnap.docs[0].id, ...settingsSnap.docs[0].data() } as QuotaSettings;
        }
        setUnitQuotas(qSettings);

        const oMap: Record<string, number[]> = {};
        ordSnap.docs.forEach(d => {
          const data = d.data() as OrdinarySchedule;
          oMap[data.policemanId] = data.days || [];
        });
        setOrdinarySchedules(oMap);
      } catch (err) {
        console.error("Error loading static data:", err);
      }
    };

    loadStaticData();

    // 2. Real-time Listeners (Volunteers, Escalas, QuotaLogs)
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);

    const unsubVolunteers = onSnapshot(
      query(collection(db, 'volunteers'), where('month', '==', mKey)),
      (snap) => {
        setVolunteers(snap.docs.map(d => ({ 
          id: d.id, 
          ...d.data(),
        } as Volunteer)));
      }
    );

    const unsubEscalas = onSnapshot(
      query(
        collection(db, 'escalas'),
        where('date', '>=', Timestamp.fromDate(start)),
        where('date', '<=', Timestamp.fromDate(end))
      ),
      (snap) => {
        setAllEscalasOfMonth(snap.docs.map(d => ({
          id: d.id,
          ...d.data()
        } as Escala)));
        setLoading(false);
      }
    );

    const unsubLogs = onSnapshot(
      query(collection(db, 'quotaLogs'), where('month', '==', mKey)),
      (snap) => {
        let usage = { PJES_MP: 0, PJES_FORUM: 0, PJES_ESCOLAR: 0, PJES_DECRETO: 0, OPS: 0 };
        const serviceUsage: Record<string, number> = {};

        snap.docs.forEach(d => {
          const log = d.data() as QuotaLog;
          if (log.serviceTypeId) {
            serviceUsage[log.serviceTypeId] = (serviceUsage[log.serviceTypeId] || 0) + log.quantidade;
          }
          if (log.tipo === 'OPS') usage.OPS += log.quantidade;
          else if (log.tipo === 'PJES') {
            if (log.pjesSubtype === 'MP') usage.PJES_MP += log.quantidade;
            else if (log.pjesSubtype === 'FORUM') usage.PJES_FORUM += log.quantidade;
            else if (log.pjesSubtype === 'ESCOLAR') usage.PJES_ESCOLAR += log.quantidade;
            else if (log.pjesSubtype === 'DECRETO') usage.PJES_DECRETO += log.quantidade;
          }
        });
        setCurrentUsage(usage);
        setServiceSpecificUsage(serviceUsage);
      }
    );

    return () => {
      unsubVolunteers();
      unsubEscalas();
      unsubLogs();
    };
  }, [currentMonth, mKey]); 


  const handleAssignService = async (serviceId: string, customAssignInfo?: { policemanId: string, date: Date }) => {
    if (submitting) return; // Prevent double clicks
    
    const assignInfo = customAssignInfo || assignmentModal;
    if (!assignInfo || !isAdmin) return;
    
    const { policemanId, date } = assignInfo;
    const service = services.find(s => s.id === serviceId);
    if (!service) return;

    const dateStr = format(date, 'yyyy-MM-dd');
    const needed = service.cotasPorServico || 1;
    
    // 1. Time Overlap check
    const timeToMinutes = (timeStr: string) => {
      if (!timeStr) return 0;
      const cleanTime = timeStr.replace(/[^\d:]/g, '');
      const [h, m] = cleanTime.split(':').map(Number);
      return (Number.isNaN(h) ? 0 : h) * 60 + (Number.isNaN(m) ? 0 : m);
    };

    const start1 = timeToMinutes(service.horarioInicio);
    let end1 = timeToMinutes(service.horarioTermino);
    if (end1 <= start1) end1 += 1440; // Turno virando o dia

    const overlappingScale = joinedEscalas.find(e => {
      const eDateStr = format(e.date.toDate(), 'yyyy-MM-dd');
      if (eDateStr !== dateStr) return false;
      if (!e.policemenIds.includes(policemanId)) return false;
      
      const otherS = e.service;
      if (!otherS) return false;

      const start2 = timeToMinutes(otherS.horarioInicio);
      let end2 = timeToMinutes(otherS.horarioTermino);
      if (end2 <= start2) end2 += 1440;

      return (start1 < end2) && (end1 > start2);
    });

    if (overlappingScale) {
       alert(`Conflito de Horário! O policial já está escalado no serviço ${overlappingScale.service?.sigla} (${overlappingScale.service?.horarioInicio}-${overlappingScale.service?.horarioTermino}) que choca com este horário.`);
       return;
    }

    // 2. Strict Duplication Check (Check same TYPE on same day - except if overlap already caught it, but we keep this to prevent dual same-type same-day even if sequential, unless user wants to allow that too?)
    // User said: "pode ser escalado juntamente ao PJES... só não pode chocar os horários". 
    // This implies PJES+OPS is OK. What about PJES+PJES? Usually NOT OK.
    const typeBeingAssigned = service.tipo; // 'PJES' or 'OPS'
    const alreadyScaledInSameType = joinedEscalas.find(e => 
      format(e.date.toDate(), 'yyyy-MM-dd') === dateStr && 
      e.policemenIds.includes(policemanId) &&
      e.service?.tipo === typeBeingAssigned
    );

    if (alreadyScaledInSameType && typeBeingAssigned === 'PJES') {
       alert(`Este policial já possui uma escala de PJES para este dia (${alreadyScaledInSameType.service?.sigla}).`);
       return;
    }

    // 3. Quota Check for the Policeman (Volunteered Quotas) - SKIP IF OPS
    if (typeBeingAssigned !== 'OPS') {
      const volunteer = joinedVolunteers.find(v => v.policemanId === policemanId && v.type === typeBeingAssigned);
      const maxAllowedQuotas = volunteer?.cotas || 0;
      
      // Sum of quotas already used by this policeman in this month for this service type
      const currentMonthCotasUsed = joinedEscalas.filter(e => 
        e.policemenIds.includes(policemanId) && 
        e.service?.tipo === typeBeingAssigned
      ).reduce((acc, e) => acc + (e.service?.cotasPorServico || 1), 0);

      if (currentMonthCotasUsed + needed > maxAllowedQuotas) {
        alert(`Erro: O policial já atingiu ou excederá o seu limite de cotas voluntárias (${maxAllowedQuotas}). Já possui ${currentMonthCotasUsed} cotas.`);
        return;
      }
    }

    const existingEscala = joinedEscalas.find(e => 
      e.serviceTypeId === serviceId && format(e.date.toDate(), 'yyyy-MM-dd') === dateStr
    );

    // 4. Vacancy Check (vagasNecessarias)
    const currentSlotsUsed = existingEscala?.policemenIds.length || 0;
    const maxSlots = service.vagasNecessarias || 0; 

    if (maxSlots > 0 && currentSlotsUsed >= maxSlots) {
      alert(`Erro: Todas as vagas (${maxSlots}) para o serviço ${service.sigla} nesta data já foram preenchidas.`);
      return;
    }

    const type = service.tipo as 'PJES' | 'OPS';
    
    // Quota Checks - SKIP UNIT QUOTA LIMIT IF OPS
    let limit = 0;
    let used = 0;
    if (type === 'OPS') { 
      limit = 0; // No limit for OPS 
    }
    else {
      const subtype = service.pjesSubtype;
      if (subtype === 'MP') { limit = unitQuotas?.pjesMPTotal || 0; used = currentUsage.PJES_MP; }
      else if (subtype === 'FORUM') { limit = unitQuotas?.pjesForumTotal || 0; used = currentUsage.PJES_FORUM; }
      else if (subtype === 'ESCOLAR') { limit = unitQuotas?.pjesEscolarTotal || 0; used = currentUsage.PJES_ESCOLAR; }
      else if (subtype === 'DECRETO') { limit = unitQuotas?.pjesDecretoTotal || 0; used = currentUsage.PJES_DECRETO; }
    }

    if (limit > 0 && used + needed > limit) {
      alert(`Erro: Cota da UNIDADE insuficiente para ${service.sigla}.`);
      return;
    }

    setSubmitting(true);
    try {
      let finalEscalaIdValue = '';
      if (existingEscala) {
        // Double check policemenIds to prevent race condition
        if (!existingEscala.policemenIds.includes(policemanId)) {
          await updateDoc(doc(db, 'escalas', existingEscala.id!), {
            policemenIds: [...new Set([...existingEscala.policemenIds, policemanId])],
            updatedAt: serverTimestamp()
          });
        }
        finalEscalaIdValue = existingEscala.id!;
      } else {
        const docRef = await addDoc(collection(db, 'escalas'), {
          serviceTypeId: serviceId,
          policemenIds: [policemanId],
          date: Timestamp.fromDate(date),
          observations: '',
          createdAt: serverTimestamp()
        });
        finalEscalaIdValue = docRef.id;
      }
      
      await addDoc(collection(db, 'quotaLogs'), {
        serviceTypeId: serviceId,
        serviceName: service.nome,
        escalaId: finalEscalaIdValue,
        tipo: service.tipo,
        pjesSubtype: service.pjesSubtype,
        quantidade: needed,
        usuarioUid: auth.currentUser?.uid,
        usuarioEmail: auth.currentUser?.email,
        policemanId: policemanId,
        data: serverTimestamp(),
        month: format(date, 'yyyy-MM')
      });

      if (!customAssignInfo) {
         setAssignmentModal(null);
      }
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
      // No need for fetchData() as onSnapshot handles it
    } catch (err) {
      console.error("Erro ao salvar escala:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveFromScale = async (escalaId: string, policemanId: string) => {
    if (!isAdmin) return;
    const escala = joinedEscalas.find(e => e.id === escalaId);
    if (!escala) return;

    setLoading(true);
    try {
      // 1. Delete associated quota logs
      const logQ = query(
        collection(db, 'quotaLogs'), 
        where('escalaId', '==', escalaId),
        where('policemanId', '==', policemanId)
      );
      const logSnap = await getDocs(logQ);
      
      // 2. Update or delete escala document
      if (escala.policemenIds.length <= 1) {
        await deleteDoc(doc(db, 'escalas', escalaId));
      } else {
        await updateDoc(doc(db, 'escalas', escalaId), {
          policemenIds: escala.policemenIds.filter(id => id !== policemanId)
        });
      }

      // 3. Batch delete logs
      for (const logDoc of logSnap.docs) {
        await deleteDoc(logDoc.ref);
      }
      
      setAssignmentModal(null);
    } catch (err) {
      console.error("Erro ao remover da escala:", err);
    } finally {
      setLoading(false);
    }
  };

  const days = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth)
  });

  const filteredVolunteers = useMemo(() => {
    const search = searchTerm.toLowerCase().trim();
    return joinedVolunteers
      .filter(v => v.type?.toUpperCase() === activeTab)
      .filter(v => {
        const poly = v.policeman;
        return !search || 
          poly?.nomeGuerra.toLowerCase().includes(search) || 
          poly?.matricula.includes(search);
      });
  }, [joinedVolunteers, activeTab, searchTerm]);

  const totalPjesLimit = (unitQuotas?.pjesMPTotal || 0) + (unitQuotas?.pjesForumTotal || 0) + (unitQuotas?.pjesEscolarTotal || 0) + (unitQuotas?.pjesDecretoTotal || 0);
  const totalPjesUsed = currentUsage.PJES_MP + currentUsage.PJES_FORUM + currentUsage.PJES_ESCOLAR + currentUsage.PJES_DECRETO;

  if (!isAdmin) return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center p-10 bg-white rounded-3xl shadow-xl border border-slate-100 max-w-sm">
        <Shield className="w-16 h-16 text-rose-500 mx-auto mb-6" />
        <h3 className="text-lg font-black text-pmpe-navy uppercase mb-2">Acesso Restrito</h3>
        <p className="text-xs font-bold text-slate-400 uppercase leading-relaxed">Você não possui permissões administrativas para gerenciar escalas.</p>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-[calc(100vh-100px)] overflow-hidden font-sans bg-slate-50">
      
      {/* Header Operational Toolbar */}
      <div className="bg-white border-b border-slate-200 p-6 flex flex-col md:flex-row items-center justify-between gap-6 shrink-0 shadow-sm z-30">
        <div className="flex flex-wrap items-center gap-6">
           <div className="flex bg-slate-50 p-1.5 rounded-2xl border border-slate-200 shadow-inner">
              <button 
                onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                className="p-2 bg-white shadow-sm border border-slate-200 rounded-xl hover:bg-slate-50 transition-all"
              ><ChevronLeft className="w-5 h-5 text-pmpe-navy" /></button>
              <div className="px-8 flex items-center min-w-[200px] justify-center">
                 <span className="text-xs font-black uppercase tracking-[0.2em] text-pmpe-navy">{format(currentMonth, 'MMMM yyyy', { locale: ptBR })}</span>
              </div>
              <button 
                onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                className="p-2 bg-white shadow-sm border border-slate-200 rounded-xl hover:bg-slate-50 transition-all"
              ><ChevronRight className="w-5 h-5 text-pmpe-navy" /></button>
           </div>
           
           <div className="relative group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-pmpe-navy transition-colors" />
              <input 
                type="text"
                placeholder="Pesquisar Policial na Matriz..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-[10px] font-black outline-none focus:ring-4 focus:ring-pmpe-navy/5 w-60 transition-all uppercase tracking-widest"
              />
           </div>

           {/* Tab Switcher */}
           <div className="flex bg-slate-100 p-1 rounded-2xl border border-slate-200">
              <button 
                onClick={() => setActiveTab('PJES')}
                className={cn(
                  "px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                  activeTab === 'PJES' ? "bg-white text-pmpe-navy shadow-sm" : "text-slate-400 hover:text-slate-600"
                )}
              >
                PJES
              </button>
              <button 
                onClick={() => setActiveTab('OPS')}
                className={cn(
                  "px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                  activeTab === 'OPS' ? "bg-white text-pmpe-navy shadow-sm" : "text-slate-400 hover:text-slate-600"
                )}
              >
                OPS
              </button>
           </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
           {/* Mini Stats in Header */}
           <div className="hidden xl:flex items-center gap-6 px-6 py-2 bg-slate-50 rounded-2xl border border-slate-100">
              <div className="text-right">
                 <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Consumo PJES</p>
                 <p className="text-xs font-black text-pmpe-navy">{Math.round((totalPjesUsed / (totalPjesLimit || 1)) * 100)}%</p>
              </div>
              <div className="w-px h-6 bg-slate-200" />
              <div className="text-right">
                 <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Consumo OPS</p>
                 <p className="text-xs font-black text-pmpe-navy">{Math.round((currentUsage.OPS / (unitQuotas?.opsTotal || 1)) * 100)}%</p>
              </div>
           </div>

           <div className="flex items-center gap-2">
              <button 
                onClick={handleDuplicateLastMonth}
                disabled={duplicating}
                className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-600 rounded-xl text-[10px] font-black uppercase hover:bg-slate-200 transition-all border border-slate-200"
              >
                 <Zap className={cn("w-3.5 h-3.5", duplicating && "animate-spin")} />
                 {duplicating ? 'Duplicando...' : 'Duplicar Configurações'}
              </button>
              
              <button className="flex items-center gap-3 px-6 py-3 bg-pmpe-navy text-white rounded-2xl text-[10px] font-black uppercase hover:bg-slate-800 transition-all shadow-xl shadow-pmpe-navy/10 border border-white/10 active:scale-95">
                 <Download className="w-4 h-4 text-pmpe-gold" /> Exportar Matriz
              </button>
           </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden flex flex-row p-6 gap-6">
        
        {/* Left Column (Matrix + Search) */}
        <div className="flex-1 flex flex-col gap-6 overflow-hidden">
          {/* Statistics Panels Row */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 shrink-0">
             <div className="bg-white p-5 rounded-[24px] border border-slate-100 shadow-md flex items-center gap-4 relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-24 h-24 bg-pmpe-navy/5 rounded-full -mr-8 -mt-8 transition-transform group-hover:scale-110" />
                <div className="p-3 bg-pmpe-navy rounded-2xl text-pmpe-gold relative z-10 shadow-lg shadow-pmpe-navy/20">
                   <Users className="w-5 h-5" />
                </div>
                <div className="relative z-10">
                   <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.1em]">Efetivo {activeTab}</p>
                   <p className="text-xl font-black text-pmpe-navy">{filteredVolunteers.length}</p>
                </div>
             </div>
             
             <div className="bg-white p-5 rounded-[24px] border border-slate-100 shadow-md flex items-center gap-4 relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full -mr-8 -mt-8 transition-transform group-hover:scale-110" />
                <div className="p-3 bg-emerald-100 rounded-2xl text-emerald-600 border border-emerald-200 relative z-10 shadow-lg shadow-emerald-500/10">
                   <CheckCircle2 className="w-5 h-5" />
                </div>
                <div className="relative z-10">
                   <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.1em]">Escalados {activeTab}</p>
                   <p className="text-xl font-black text-pmpe-navy">
                      {joinedEscalas.filter(e => e.service?.tipo === activeTab).length}
                   </p>
                </div>
             </div>

             <div className="bg-white p-5 rounded-[24px] border border-slate-100 shadow-md flex items-center gap-4 relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/5 rounded-full -mr-8 -mt-8 transition-transform group-hover:scale-110" />
                <div className="p-3 bg-rose-100 rounded-2xl text-rose-600 border border-rose-200 relative z-10 shadow-lg shadow-rose-500/10">
                   <Zap className="w-5 h-5" />
                </div>
                <div className="relative z-10">
                   <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.1em]">Total {activeTab} Unidade</p>
                   <div className="flex items-baseline gap-1">
                      <p className="text-xl font-black text-pmpe-navy font-mono">
                         {activeTab === 'PJES' ? totalPjesUsed : currentUsage.OPS} 
                      </p>
                      <p className="text-[10px] font-bold text-slate-300"> / {activeTab === 'PJES' ? totalPjesLimit : unitQuotas?.opsTotal}</p>
                   </div>
                </div>
             </div>

             <div className="bg-white p-5 rounded-[24px] border border-slate-100 shadow-md flex items-center gap-4 relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-24 h-24 bg-pmpe-gold/5 rounded-full -mr-8 -mt-8 transition-transform group-hover:scale-110" />
                <div className="p-3 bg-pmpe-gold/20 rounded-2xl text-amber-600 border border-amber-200 relative z-10 shadow-lg shadow-pmpe-gold/20">
                   <Target className="w-5 h-5" />
                </div>
                <div className="relative z-10">
                   <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.1em]">Saldo Disponível</p>
                   <p className="text-xl font-black text-emerald-600 font-mono">
                      {activeTab === 'PJES' ? (totalPjesLimit - totalPjesUsed) : ((unitQuotas?.opsTotal || 0) - currentUsage.OPS)}
                   </p>
                </div>
             </div>
          </div>

          {/* Operational Matrix Board */}
          <div className="flex-1 bg-white rounded-[32px] shadow-2xl border border-slate-100 overflow-hidden flex flex-col relative">
            
            <div className="flex-1 overflow-auto custom-matrix-scroll p-1">
              <table className="w-full border-separate border-spacing-0 text-[11px] font-sans">
                <thead className="sticky top-0 z-[20]">
                  <tr className="bg-pmpe-navy text-white h-16">
                    {/* Fixed Columns Headers */}
                    <th className="sticky left-0 z-30 p-3 min-w-[60px] bg-pmpe-navy text-center font-black uppercase text-[10px] border-b-2 border-black">GRA.</th>
                    <th className="sticky left-[60px] z-30 p-3 min-w-[90px] bg-pmpe-navy text-center font-black uppercase text-[10px] border-b-2 border-black border-l-2 border-black">MAT.</th>
                    <th className="sticky left-[150px] z-30 p-4 min-w-[200px] bg-pmpe-navy text-left font-black uppercase text-[10px] border-b-2 border-black border-l-2 border-black uppercase tracking-wider">EFETIVO</th>
                    
                    {/* Stats Columns Headers */}
                    <th className="p-3 min-w-[60px] bg-pmpe-gold text-pmpe-navy font-black text-[9px] uppercase border-b-2 border-black text-center tracking-tighter">SOLIC.</th>
                    <th className="p-3 min-w-[60px] bg-pmpe-gold text-pmpe-navy font-black text-[9px] uppercase border-b-2 border-black text-center tracking-tighter">DISP.</th>
                    <th className="p-3 min-w-[60px] bg-emerald-600 font-black text-[9px] uppercase border-b-2 border-black text-center tracking-tighter">ESCAL.</th>
                    <th className="p-3 min-w-[60px] bg-rose-600 font-black text-[9px] uppercase border-b-2 border-black text-center tracking-tighter">A ESC.</th>
                    
                    {/* Days Multi-Column (Matrix) */}
                    {days.map(day => {
                      const isWknd = isWeekend(day);
                      return (
                        <th 
                          key={day.toISOString()} 
                          className={cn(
                            "min-w-[50px] p-2 border-b-2 border-black border-l-2 border-black text-center transition-colors group/header",
                            isWknd ? "bg-red-600" : "bg-blue-700 hover:bg-blue-800"
                          )}
                        >
                           <div className="flex flex-col items-center relative">
                              <span className="text-[7px] font-bold opacity-80 mb-0.5 leading-none uppercase">{format(day, 'EEE', { locale: ptBR })}</span>
                              <span className="text-[14px] font-black leading-none">{format(day, 'dd')}</span>
                              
                              {/* Suggest Mode Indicator */}
                              {selectedServiceId && (
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    suggestBestPM(day);
                                  }}
                                  title="Sugerir Melhor Policial para este dia"
                                  className="absolute -bottom-1 left-1/2 -translate-x-1/2 translate-y-full opacity-0 group-hover/header:opacity-100 transition-all p-1 bg-white rounded-full shadow-lg border border-slate-200 z-50 text-pmpe-navy hover:scale-110 active:scale-95"
                                >
                                   <Zap className="w-2.5 h-2.5 fill-pmpe-gold text-pmpe-gold" />
                                </button>
                              )}
                           </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                     <tr>
                       <td colSpan={days.length + 7} className="p-32 text-center">
                          <div className="flex flex-col items-center gap-6">
                             <div className="w-16 h-16 border-4 border-pmpe-navy/10 border-t-pmpe-navy rounded-full animate-spin" />
                             <p className="text-sm font-black text-pmpe-navy uppercase tracking-[0.2em] animate-pulse">Processando Matriz Operacional...</p>
                          </div>
                       </td>
                     </tr>
                  ) : filteredVolunteers.map(v => {
                    const scaledPMRecords = joinedEscalas.filter(e => e.policemenIds.includes(v.policemanId));
                    const scaledCount = scaledPMRecords.length;
                    const solicted = v.cotas || 0;
                    const remaining = solicted - scaledCount;

                    return (
                      <tr key={v.id} className="h-12 hover:bg-slate-50 transition-colors group">
                        {/* Fixed ID Info */}
                        <td className="sticky left-0 z-10 p-3 bg-white group-hover:bg-slate-50 text-center font-black text-slate-500 border-r-2 border-b-2 border-black">{v.policeman?.graduacaoPosto.substring(0, 3)}</td>
                        <td className="sticky left-[60px] z-10 p-3 bg-white group-hover:bg-slate-50 text-center font-bold text-slate-500 border-r-2 border-b-2 border-black">{v.policeman?.matricula}</td>
                        <td className="sticky left-[150px] z-10 p-3 bg-white group-hover:bg-slate-50 font-black text-pmpe-navy uppercase pl-5 border-r-2 border-b-2 border-black truncate">
                           {v.policeman?.nomeGuerra}
                        </td>

                        {/* Stats Dynamic Columns */}
                        <td className="bg-amber-50/20 text-center font-black text-amber-600 border-r-2 border-b-2 border-black text-[12px]">{solicted}</td>
                        <td className="bg-slate-50/50 text-center font-bold text-slate-300 italic border-r-2 border-b-2 border-black text-[12px]">{days.length - (ordinarySchedules[v.policemanId]?.length || 0)}</td>
                        <td className="bg-emerald-50/50 text-center font-black text-emerald-600 border-r-2 border-b-2 border-black text-[12px]">{scaledCount}</td>
                        <td className={cn(
                          "text-center font-black border-r-2 border-b-2 border-black text-[12px]",
                          remaining > 0 ? "bg-rose-50/50 text-rose-600" : "bg-emerald-50 text-emerald-500"
                        )}>{remaining}</td>

                        {/* Matrix cells for each day */}
                        {days.map(date => {
                          const dayNum = getDate(date);
                          const isOrd = (ordinarySchedules[v.policemanId] || []).includes(dayNum);
                          const scales = scaledPMRecords.filter(e => isSameDay(e.date.toDate(), date));
                          const currentSelectedService = selectedServiceId ? services.find(s => s.id === selectedServiceId) : null;
                          const dateStr = format(date, 'yyyy-MM-dd');

                          // Vacancy check for the selected service on this specific date
                          const escalaToday = joinedEscalas.find(e => e.serviceTypeId === selectedServiceId && format(e.date.toDate(), 'yyyy-MM-dd') === dateStr);
                          const slotsUsed = escalaToday?.policemenIds.length || 0;
                          const slotsMax = currentSelectedService?.vagasNecessarias || 0;
                          const isFull = slotsMax > 0 && slotsUsed >= slotsMax;

                          const isServiceActiveOnThisDay = currentSelectedService ? (
                             currentSelectedService.activationType === 'ALL' || 
                             (currentSelectedService.activeDates || []).includes(dateStr)
                          ) : false;
                          
                          // Check if person already has a scale of the SAME type as currently selected
                          const hasSameTypeScale = currentSelectedService && scales.some(s => s.service?.tipo === currentSelectedService.tipo);

                          const isCurrentlyTarget = assignmentModal?.policemanId === v.policemanId && isSameDay(assignmentModal.date, date);
                          const isSubmittingThisCell = submitting && isCurrentlyTarget;
                          
                          return (
                            <td 
                              key={date.toISOString()}
                              onDragOver={(e) => {
                                if (!isOrd && !hasSameTypeScale) {
                                  e.preventDefault();
                                  e.currentTarget.classList.add('bg-emerald-100');
                                }
                              }}
                              onDragLeave={(e) => {
                                e.currentTarget.classList.remove('bg-emerald-100');
                              }}
                              onDrop={(e) => {
                                if (isOrd || submitting) return;
                                e.preventDefault();
                                e.currentTarget.classList.remove('bg-emerald-100');
                                const draggedServiceId = e.dataTransfer.getData('serviceId');
                                if (draggedServiceId) {
                                  // Validation for active day
                                  const ds = services.find(s => s.id === draggedServiceId);
                                  
                                  // Specific type check for drop
                                  const alreadyHasType = ds && scales.some(s => s.service?.tipo === ds.tipo);
                                  if (alreadyHasType && ds?.tipo === 'PJES') {
                                    alert(`Este policial já possui uma escala de PJES para este dia.`);
                                    return;
                                  }

                                  const dStr = format(date, 'yyyy-MM-dd');
                                  const active = ds && (ds.activationType === 'ALL' || (ds.activeDates || []).includes(dStr));
                                  
                                  if (!active) {
                                    alert('Este serviço não está ativo para esta data específica.');
                                    return;
                                  }

                                  // Vacancy Check for drop
                                  const scaleToday = joinedEscalas.find(e => e.serviceTypeId === draggedServiceId && format(e.date.toDate(), 'yyyy-MM-dd') === dStr);
                                  const used = scaleToday?.policemenIds.length || 0;
                                  const max = ds.vagasNecessarias || 0;
                                  if (max > 0 && used >= max) {
                                    alert(`Este serviço (${ds.sigla}) já atingiu o limite de vagas para este dia.`);
                                    return;
                                  }

                                  handleAssignService(draggedServiceId, { 
                                    policemanId: v.policemanId, 
                                    date 
                                  });
                                }
                              }}
                              onClick={() => {
                                if (isOrd || submitting) return;
                                if (selectedServiceId) {
                                  if (!isServiceActiveOnThisDay) {
                                    alert('Este serviço não está configurado para estar ativo nesta data.');
                                    return;
                                  }

                                  if (isFull) {
                                    alert('Todas as vagas para este serviço já foram preenchidas nesta data.');
                                    return;
                                  }
                                  
                                  if (hasSameTypeScale && currentSelectedService?.tipo === 'PJES') {
                                     alert(`Este policial já possui uma escala de PJES para este dia.`);
                                     return;
                                  }

                                  handleAssignService(selectedServiceId, { 
                                    policemanId: v.policemanId, 
                                    date 
                                  });
                                } else {
                                  setAssignmentModal({ 
                                    policemanId: v.policemanId, 
                                    policemanName: v.policeman?.nomeGuerra || 'PM',
                                    policemanMat: v.policeman?.matricula || '',
                                    date
                                  });
                                }
                              }}
                              className={cn(
                                "relative p-0 border-r-2 border-b-2 border-black transition-all text-center h-14 w-14",
                                !isOrd ? "cursor-pointer" : "bg-slate-800",
                                scales.length === 0 && !isOrd ? "bg-slate-100/80 hover:bg-slate-200" : "",
                                selectedServiceId && isServiceActiveOnThisDay && !isOrd && !hasSameTypeScale ? (
                                  isFull 
                                    ? "bg-rose-50/70 ring-inset ring-2 ring-rose-500/30 cursor-not-allowed opacity-60" 
                                    : "bg-emerald-50/50 ring-inset ring-2 ring-emerald-500/20 z-10"
                                ) : "",
                                isSubmittingThisCell ? "bg-amber-100" : ""
                              )}
                            >
                               <div className="w-full h-full flex flex-col items-stretch justify-center font-black text-[9px] uppercase tracking-tighter overflow-hidden">
                                  {isSubmittingThisCell && scales.length === 0 ? (
                                    <div className="flex items-center justify-center h-full">
                                      <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                                    </div>
                                  ) : scales.length > 0 ? (
                                    <div className="flex flex-col h-full w-full">
                                      {scales.map((s, idx) => (
                                        <motion.div 
                                          key={s.id || idx}
                                          initial={{ scale: 0.8, opacity: 0 }} 
                                          animate={{ scale: 1, opacity: 1 }}
                                          className="flex-1 flex flex-col items-center justify-center text-white drop-shadow-sm px-1 border-b border-black/10 last:border-0 py-0.5 overflow-hidden"
                                          style={{ backgroundColor: s.service?.color || '#334155' }}
                                        >
                                          <div className="flex flex-col items-center justify-center text-center w-full min-h-0">
                                             <span className="text-[8px] font-black leading-tight tracking-tighter">{s.service?.sigla || 'ESC'}</span>
                                             <span className="text-[6px] font-black opacity-90 leading-none truncate w-full px-0.5 mt-0.5 uppercase">{s.service?.nome}</span>
                                          </div>
                                          {s.service?.vagasNecessarias && s.policemenIds.length >= s.service.vagasNecessarias && (
                                            <div className="absolute top-0 right-0 p-0.5">
                                              <Check className="w-1.5 h-1.5 text-emerald-400" />
                                            </div>
                                          )}
                                        </motion.div>
                                      ))}
                                      {isSubmittingThisCell && (
                                        <div className="bg-amber-100 flex items-center justify-center py-0.5">
                                          <div className="w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                                        </div>
                                      )}
                                    </div>
                                  ) : isOrd ? (
                                    <span className="text-white/30 text-[8px] font-black">ORD</span>
                                  ) : isFull && selectedServiceId ? (
                                    <div className="w-full h-full flex flex-col items-center justify-center bg-rose-50/50">
                                      <span className="text-[8px] text-rose-500 font-black leading-none mb-0.5">LOTADO</span>
                                      <span className="text-[10px] font-black text-rose-600">{slotsUsed}/{slotsMax}</span>
                                    </div>
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center group-matrix-cell">
                                       <span className={cn(
                                          "text-[12px] font-bold transition-all",
                                          selectedServiceId && isServiceActiveOnThisDay ? "text-emerald-600 animate-pulse scale-150" : "text-slate-300"
                                       )}>0</span>
                                    </div>
                                  )}
                               </div>
                               
                               {!isOrd && (
                                 <div className={cn(
                                    "absolute inset-x-0 bottom-0 h-0.5 scale-x-0 group-matrix-cell-hover:scale-x-100 transition-transform origin-center",
                                    selectedServiceId ? "bg-emerald-500" : "bg-pmpe-navy"
                                 )} />
                               )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Matrix Ledger / Legend Footer */}
            <div className="bg-slate-50 border-t border-slate-200 p-4 flex flex-wrap gap-6 items-center shrink-0">
               <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-red-600 rounded shadow-sm" />
                  <span className="text-[9px] font-black text-slate-500 uppercase">Finais de Semana</span>
               </div>
               <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-blue-700 rounded shadow-sm" />
                  <span className="text-[9px] font-black text-slate-500 uppercase">Dias de Semana</span>
               </div>
               <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-slate-100 border border-slate-200 rounded shadow-sm flex items-center justify-center text-[8px] text-slate-300 font-bold">0</div>
                  <span className="text-[9px] font-black text-slate-500 uppercase">Disponível para Escala</span>
               </div>
               <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-slate-800 rounded shadow-sm flex items-center justify-center text-[7px] text-white/40 font-black">ORD</div>
                  <span className="text-[9px] font-black text-slate-500 uppercase">Serviço Ordinário</span>
               </div>
               <div className="ml-auto flex items-center gap-2">
                  <span className="text-[9px] font-black text-pmpe-navy uppercase opacity-40 italic tracking-widest">Utilize as SIGLAS dos serviços para identificação.</span>
               </div>
            </div>

          </div>
        </div>

        {/* Right Sidebar: Services Dictionary */}
        <div className="w-80 flex flex-col gap-6 shrink-0 h-full overflow-hidden">
           {/* Services List Panel */}
           <div className="flex-1 bg-white rounded-[32px] border border-slate-200 shadow-xl overflow-hidden flex flex-col">
              <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                 <div className="flex items-center justify-between mb-4">
                    <h3 className="text-[10px] font-black text-pmpe-navy uppercase tracking-[0.2em] flex items-center gap-2">
                       <Shield className="w-4 h-4 text-pmpe-gold" />
                       Dicionário de Serviços ({activeTab})
                    </h3>
                    {selectedServiceId && (
                       <button 
                         onClick={() => setSelectedServiceId(null)}
                         className="text-[8px] font-black text-rose-500 uppercase hover:bg-rose-50 px-2 py-1 rounded-lg transition-colors border border-rose-100"
                       >
                          Limpar Seleção
                       </button>
                    )}
                 </div>
                 <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                    <input 
                       type="text"
                       placeholder="Filtrar Serviços..."
                       value={serviceSearchTerm}
                       onChange={(e) => setServiceSearchTerm(e.target.value)}
                       className="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-[9px] font-bold outline-none focus:ring-2 focus:ring-pmpe-navy/10 uppercase"
                    />
                 </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-none">
                 {services
                   .filter(s => {
                      const matchesTab = s.tipo?.toUpperCase() === activeTab;
                      const matchesMonth = s.month === mKey;
                      const matchesSearch = !serviceSearchTerm || s.sigla.toLowerCase().includes(serviceSearchTerm.toLowerCase()) || s.nome.toLowerCase().includes(serviceSearchTerm.toLowerCase());
                      return matchesTab && matchesMonth && matchesSearch;
                   })
                   .map(s => (
                    <div 
                       key={s.id} 
                       onClick={() => setSelectedServiceId(selectedServiceId === s.id ? null : s.id!)}
                       onDoubleClick={(e) => {
                          e.stopPropagation();
                          setSelectedServiceId(null);
                       }}
                       className={cn(
                          "p-3 rounded-2xl border transition-all group cursor-pointer select-none",
                          selectedServiceId === s.id 
                            ? "bg-pmpe-navy border-pmpe-navy shadow-lg ring-2 ring-pmpe-navy/10 -translate-y-1" 
                            : "border-slate-50 bg-slate-50/30 hover:bg-white hover:border-slate-200 hover:shadow-md"
                       )}
                    >
                       <div className="flex items-center gap-3">
                          <div 
                             draggable
                             onDragStart={(e) => {
                                e.dataTransfer.setData('serviceId', s.id!);
                                setSelectedServiceId(s.id!);
                             }}
                             onDragEnd={() => setSelectedServiceId(null)}
                             className={cn(
                                "w-10 h-10 rounded-xl flex items-center justify-center font-black text-[10px] shadow-sm transform transition-transform cursor-grab active:cursor-grabbing",
                                selectedServiceId === s.id ? "scale-110 bg-white" : "group-hover:scale-110"
                             )} 
                             style={selectedServiceId === s.id ? { color: s.color } : { backgroundColor: s.color, color: 'white' }}
                          >
                             {s.sigla}
                          </div>
                          <div className="flex-1 min-w-0">
                             <div className="flex items-center justify-between gap-2 overflow-hidden">
                                <p className={cn(
                                   "text-[10px] font-black uppercase leading-tight truncate",
                                   selectedServiceId === s.id ? "text-white" : "text-pmpe-navy"
                                )}>{s.nome}</p>
                             </div>
                             <div className="flex items-center gap-2 mt-1">
                                <span className={cn(
                                   "text-[7px] font-bold uppercase tracking-tighter",
                                   selectedServiceId === s.id ? "text-white/60" : "text-slate-400"
                                )}>COTA: {s.cotasPorServico || 1}</span>
                                <div className={cn("w-1 h-1 rounded-full", selectedServiceId === s.id ? "bg-white/20" : "bg-slate-200")} />
                                <span className={cn(
                                   "text-[7px] font-bold uppercase tracking-tighter",
                                   selectedServiceId === s.id ? "text-white/60" : "text-slate-400"
                                )}>{s.horarioInicio} - {s.horarioTermino}</span>
                             </div>
                          </div>
                       </div>
                    </div>
                 ))}
                 {services.filter(s => s.tipo?.toUpperCase() === activeTab && s.month === mKey).length === 0 && (
                    <div className="p-8 text-center">
                       <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
                          <AlertCircle className="w-6 h-6 text-slate-300" />
                       </div>
                       <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-relaxed">
                          Nenhum serviço de {activeTab} cadastrado para o mês de {format(currentMonth, 'MMMM', { locale: ptBR })}.
                       </p>
                    </div>
                 )}
              </div>
              <div className="p-4 bg-slate-50 border-t border-slate-100">
                 <div className="flex items-center gap-4 px-3 py-2 bg-pmpe-navy/5 rounded-xl">
                    <Zap className={cn("w-3 h-3 text-pmpe-gold", selectedServiceId && "animate-pulse")} />
                    <div className="flex-1">
                       <p className="text-[7px] font-bold text-pmpe-navy uppercase leading-tight italic">
                          {selectedServiceId 
                            ? "MODO PINCEL ATIVO: Clique no '0' para pintar a escala."
                            : "Clique no '0' na matriz para lançar estes serviços."}
                       </p>
                    </div>
                 </div>
              </div>
           </div>
        </div>
      </div>

      {/* Advanced Selection Modal */}
      <AnimatePresence>
        {assignmentModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-md">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white rounded-[48px] w-full max-w-lg overflow-hidden shadow-2xl border border-white/20"
            >
               <div className="p-10 border-b border-slate-50 bg-slate-50/50 flex items-center justify-between">
                  <div className="flex items-center gap-6">
                    <div className="w-16 h-16 bg-pmpe-navy rounded-[24px] flex items-center justify-center shadow-2xl shadow-pmpe-navy/30 relative">
                       <Users className="w-8 h-8 text-pmpe-gold" />
                       <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-emerald-500 rounded-lg flex items-center justify-center shadow-lg transform rotate-12">
                          <Check className="w-3 h-3 text-white" />
                       </div>
                    </div>
                    <div>
                      <h3 className="text-lg font-black text-pmpe-navy uppercase tracking-tight leading-none">{assignmentModal.policemanName}</h3>
                      <div className="flex items-center gap-3 mt-2">
                        <span className="text-[9px] font-black bg-pmpe-navy/10 text-pmpe-navy px-2.5 py-1 rounded-full uppercase">{assignmentModal.policemanMat}</span>
                        <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase">
                          <CalendarIcon className="w-3 h-3" /> 
                          {format(assignmentModal.date, "dd 'de' MMMM", { locale: ptBR })}
                        </div>
                      </div>
                    </div>
                  </div>
                  <button onClick={() => setAssignmentModal(null)} className="p-4 hover:bg-slate-200 rounded-[20px] transition-all shadow-sm"><X className="w-6 h-6 text-slate-400" /></button>
               </div>

               <div className="p-10 space-y-8 max-h-[60vh] overflow-y-auto scrollbar-none bg-white">
                  
                  {/* Active Scale Info */}
                  {(() => {
                    const scaled = joinedEscalas.filter(e => 
                      isSameDay(e.date.toDate(), assignmentModal.date) && e.policemenIds.includes(assignmentModal.policemanId)
                    );
                    if (scaled.length > 0) {
                      return (
                        <div className="space-y-3">
                           <label className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Lançamentos de Escala Existentes</label>
                           {scaled.map(e => (
                             <div key={e.id} className="p-6 bg-rose-50 border border-rose-100 rounded-[32px] flex items-center justify-between shadow-inner">
                                <div className="flex items-center gap-4">
                                   <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm" style={{ color: e.service?.color }}>
                                      <span className="text-xs font-black">{e.service?.sigla}</span>
                                   </div>
                                   <div>
                                      <p className="text-[10px] font-black text-rose-600 uppercase tracking-widest">{e.service?.nome}</p>
                                      <p className="text-[11px] font-black text-pmpe-navy uppercase tracking-tighter mt-0.5">Remover agendamento atual?</p>
                                   </div>
                                </div>
                                <button 
                                  onClick={() => handleRemoveFromScale(e.id!, assignmentModal.policemanId)}
                                  className="w-12 h-12 bg-white text-rose-500 rounded-2xl shadow-md border border-rose-100 hover:bg-rose-500 hover:text-white transition-all transform active:scale-90 flex items-center justify-center"
                                ><Trash2 className="w-5 h-5" /></button>
                             </div>
                           ))}
                        </div>
                      );
                    }
                    return (
                        <div className="p-5 bg-emerald-50 border border-emerald-100 rounded-3xl flex items-center gap-4 shadow-inner">
                           <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-emerald-500 shadow-sm border border-emerald-50">
                              <ShieldCheck className="w-6 h-6" />
                           </div>
                           <div className="flex-1">
                              <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest leading-none mb-1">Status Disponível</p>
                              <p className="text-[11px] font-bold text-slate-400 uppercase leading-none italic">Nenhuma escala extra lançada para este dia.</p>
                           </div>
                        </div>
                    );
                  })()}

                  <div className="space-y-4">
                     <div className="flex flex-col gap-4 px-1">
                        <div className="flex items-center justify-between">
                           <label className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">Serviços Ativos em {format(assignmentModal.date, 'dd/MM')}</label>
                           <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-100 uppercase italic">Selecione para Agendar</span>
                        </div>
                        
                        <div className="relative">
                           <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                           <input 
                             type="text"
                             placeholder="Filtrar Serviços (Sigla ou Nome)..."
                             value={serviceSearchTerm}
                             onChange={(e) => setServiceSearchTerm(e.target.value)}
                             className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-[10px] font-bold outline-none focus:ring-2 focus:ring-pmpe-navy/10 uppercase"
                           />
                        </div>
                     </div>

                     <div className="grid grid-cols-1 gap-3">
                        {(() => {
                          const availableServices = services.filter(s => {
                            const dStr = format(assignmentModal.date, 'yyyy-MM-dd');
                            const isActiveDay = s.activationType === 'ALL' || (s.activeDates || []).includes(dStr);
                            const isAlreadyIn = joinedEscalas.some(e => e.serviceTypeId === s.id && isSameDay(e.date.toDate(), assignmentModal.date) && e.policemenIds.includes(assignmentModal.policemanId));
                            const isCorrectType = s.tipo?.toUpperCase() === activeTab;
                            const matchesMonth = s.month === mKey;
                            const matchesSearch = !serviceSearchTerm || s.sigla.toLowerCase().includes(serviceSearchTerm.toLowerCase()) || s.nome.toLowerCase().includes(serviceSearchTerm.toLowerCase());
                            
                            return isActiveDay && !isAlreadyIn && isCorrectType && matchesMonth && matchesSearch;
                          });

                          if (availableServices.length === 0) {
                            return (
                              <div className="p-12 text-center bg-slate-50 rounded-[40px] border-2 border-dashed border-slate-200">
                                <div className="w-16 h-16 bg-white rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-sm">
                                  <AlertCircle className="w-8 h-8 text-slate-300" />
                                </div>
                                <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest leading-relaxed px-6">
                                  Nenhum serviço de {activeTab} disponível para esta data específica. Clique nos serviços ao lado para gerenciar as datas ativas.
                                </p>
                              </div>
                            );
                          }

                          return availableServices.map(s => {
                            const escToday = joinedEscalas.find(e => e.serviceTypeId === s.id && isSameDay(e.date.toDate(), assignmentModal.date));
                            const pToday = escToday?.policemenIds.length || 0;
                            const target = s.vagasNecessarias || 0;
                            const isFull = target > 0 && pToday >= target;

                            return (
                              <button 
                                key={s.id}
                                disabled={submitting || isFull}
                                onClick={() => handleAssignService(s.id!)}
                                className={cn(
                                  "p-4 rounded-2xl flex items-center justify-between group transition-all text-left shadow-sm bg-white border border-slate-100",
                                  isFull ? "opacity-50 grayscale cursor-not-allowed" : "hover:border-pmpe-navy/30 hover:bg-slate-50 hover:shadow-2xl active:scale-[0.98]"
                                )}
                              >
                                 <div className="flex items-center gap-5">
                                    <div className="w-14 h-14 rounded-[20px] flex items-center justify-center shadow-xl transition-transform group-hover:scale-110" style={{ backgroundColor: s.color + '15', color: s.color, border: `1px solid ${s.color}20` }}>
                                       <span className="text-xs font-black">{s.sigla}</span>
                                    </div>
                                    <div>
                                       <p className="text-[12px] font-black text-pmpe-navy uppercase leading-tight mb-1">{s.nome}</p>
                                       <div className="flex items-center gap-3">
                                         <div className="flex items-center gap-1.5 text-[9px] font-black text-slate-400 uppercase tracking-tighter">
                                           <Clock className="w-3 h-3" /> {s.horarioInicio} - {s.horarioTermino}
                                         </div>
                                         {(s.cotasPorServico || 1) > 1 && (
                                           <span className="text-[8px] font-black bg-rose-50 text-rose-500 px-2 py-0.5 rounded-lg border border-rose-100">-{s.cotasPorServico} COTAS</span>
                                         )}
                                       </div>
                                    </div>
                                 </div>
                                 <div className="flex flex-col items-end gap-1.5">
                                    <div className={cn(
                                      "text-[10px] font-black px-4 py-1.5 rounded-2xl uppercase border flex items-center gap-2 transition-all",
                                      isFull ? "bg-rose-50 text-rose-600 border-rose-100" : "bg-emerald-50 text-emerald-600 border-emerald-100 group-hover:bg-pmpe-navy group-hover:text-white"
                                    )}>
                                       <Users className="w-3 h-3" />
                                       {pToday}/{target || '∞'}
                                    </div>
                                    {isFull && <span className="text-[7px] font-black text-rose-500 uppercase">LOTADO</span>}
                                 </div>
                              </button>
                            );
                          });
                        })()}
                     </div>
                  </div>
               </div>
               
               <div className="p-5 bg-slate-50/50 border-t border-slate-100 flex gap-4">
                  <button 
                    onClick={() => setAssignmentModal(null)}
                    className="flex-1 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-600 transition-colors"
                  >Fechar</button>
               </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Success Notification */}
      <AnimatePresence>
        {success && (
          <motion.div
            initial={{ opacity: 0, y: 100, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 100, scale: 0.8 }}
            className="fixed bottom-12 inset-x-0 mx-auto w-fit bg-pmpe-navy text-white px-10 py-6 rounded-[32px] shadow-2xl z-[150] flex items-center gap-6 border border-white/10"
          >
            <div className="w-14 h-14 bg-emerald-500 rounded-2xl flex items-center justify-center shadow-xl shadow-emerald-500/40">
               <CheckCircle2 className="w-8 h-8 text-white" />
            </div>
            <div>
              <p className="text-base font-black uppercase tracking-tight">Matriz Atualizada</p>
              <p className="text-[10px] font-bold text-white/50 uppercase tracking-[0.2em] mt-1 italic">Lançamento operacional sincronizado com sucesso.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-matrix-scroll::-webkit-scrollbar { width: 10px; height: 10px; }
        .custom-matrix-scroll::-webkit-scrollbar-track { background: transparent; }
        .custom-matrix-scroll::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 20px; border: 3px solid #fff; }
        .custom-matrix-scroll::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
        
        .scrollbar-none::-webkit-scrollbar { display: none; }
        .scrollbar-none { -ms-overflow-style: none; scrollbar-width: none; }

        .group-matrix-cell:hover .group-matrix-cell-hover\\:opacity-100 { opacity: 1; }
        .group-matrix-cell:hover .group-matrix-cell-hover\\:text-slate-400 { color: #94a3b8; }
        .group-matrix-cell:hover .group-matrix-cell-hover\\:flex { display: flex; }
      `}</style>
    </div>
  );
};

export default CreateEscala;
