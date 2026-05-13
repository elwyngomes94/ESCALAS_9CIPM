import React, { useState, useEffect, useRef } from 'react';
import { 
  collection, 
  getDocs, 
  addDoc, 
  doc,
  query, 
  where,
  orderBy,
  serverTimestamp,
  Timestamp,
  deleteDoc,
  updateDoc
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { Policeman, ServiceType, Volunteer, Escala } from '../types';
import { OperationType, handleFirestoreError, cn } from '../lib/utils';
import { sortPolicemen } from '../lib/utils/policeUtils';
import { useAuth } from '../contexts/AuthContext';
import { 
  Plus, 
  Search, 
  X, 
  Save, 
  Calendar as CalendarIcon,
  Briefcase,
  Users,
  CheckCircle2,
  AlertCircle,
  Clock,
  Car,
  Crown,
  ChevronLeft,
  ChevronRight,
  Filter,
  UserPlus,
  ArrowRightLeft,
  Trash2,
  Shield,
  Info,
  Zap,
  Target,
  Eye,
  Settings2,
  Lock,
  Smartphone
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  eachDayOfInterval, 
  getDate, 
  isSameDay, 
  getDay,
  parseISO,
  addMonths,
  subMonths
} from 'date-fns';
import { ptBR } from 'date-fns/locale';

// FullCalendar
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin, { Draggable } from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';

const CreateEscala = () => {
  const { isAdmin } = useAuth();
  const [services, setServices] = useState<ServiceType[]>([]);
  const [volunteers, setVolunteers] = useState<(Volunteer & { policeman?: Policeman })[]>([]);
  const [allEscalasOfMonth, setAllEscalasOfMonth] = useState<(Escala & { service?: ServiceType })[]>([]);
  const [ordinarySchedules, setOrdinarySchedules] = useState<Record<string, number[]>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'ALL' | 'PJES' | 'OPS'>('ALL');
  const [filterPlatoon, setFilterPlatoon] = useState('ALL');
  const [filterOnlyAvailable, setFilterOnlyAvailable] = useState(false);
  const [focusedPolicemanId, setFocusedPolicemanId] = useState<string | null>(null);
  const [assistedMode, setAssistedMode] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<any>(null);
  const [calendarFilter, setCalendarFilter] = useState<'ALL' | 'PJES' | 'OPS' | 'ORD'>('ALL');
  const [quickCreateDate, setQuickCreateDate] = useState<Date | null>(null);
  const [unitQuotas, setUnitQuotas] = useState<any>(null);
  const [currentUsage, setCurrentUsage] = useState({ PJES: 0, OPS: 0 });

  const calendarRef = useRef<FullCalendar>(null);
  const draggablesDone = useRef(false);

  useEffect(() => {
    // Enable external draggables
    if (!draggablesDone.current && volunteers.length > 0) {
      const containerEl = document.getElementById('external-volunteers');
      if (containerEl) {
        new Draggable(containerEl, {
          itemSelector: '.fc-event',
          eventData: (eventEl) => {
            return {
              title: eventEl.getAttribute('data-name'),
              id: eventEl.getAttribute('data-id'),
              extendedProps: {
                policemanId: eventEl.getAttribute('data-id')
              }
            };
          }
        });
        draggablesDone.current = true;
      }
    }
  }, [volunteers]);

  const fetchData = async () => {
    setLoading(true);
    const mKey = format(currentMonth, 'yyyy-MM');
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);

    try {
      // 1. Fetch Service Types for this month
      const sSnap = await getDocs(query(collection(db, 'serviceTypes'), where('month', '==', mKey)));
      const sData = sSnap.docs.map(d => {
        const data = d.data();
        return { 
          id: d.id, 
          ...data,
          activeDates: data.activeDates || []
        } as ServiceType;
      });
      setServices(sData);

      // 2. Fetch Volunteers for the month
      const vSnap = await getDocs(query(collection(db, 'volunteers'), where('month', '==', mKey)));
      const polySnap = await getDocs(collection(db, 'policemen'));
      const polyData = polySnap.docs.reduce((acc, d) => {
        acc[d.id] = { id: d.id, ...d.data() } as Policeman;
        return acc;
      }, {} as Record<string, Policeman>);

      const vData = vSnap.docs.map(vDoc => {
        const v = { id: vDoc.id, ...vDoc.data() } as Volunteer;
        return { ...v, policeman: polyData[v.policemanId] };
      });
      setVolunteers(vData);

      // 3. Fetch All Scales for the interval
      const eSnap = await getDocs(query(
        collection(db, 'escalas'), 
        where('date', '>=', Timestamp.fromDate(start)),
        where('date', '<=', Timestamp.fromDate(end))
      ));
      const eData = eSnap.docs.map(d => {
        const data = d.data() as Escala;
        return { 
          id: d.id, 
          ...data,
          service: sData.find(s => s.id === data.serviceTypeId)
        };
      });
      setAllEscalasOfMonth(eData);

      // 4. Fetch Ordinary Schedules
      const ordSnap = await getDocs(query(collection(db, 'ordinarySchedules'), where('month', '==', mKey)));
      const oMap: Record<string, number[]> = {};
      ordSnap.docs.forEach(d => {
        const data = d.data();
        oMap[data.policemanId] = data.days || [];
      });
      setOrdinarySchedules(oMap);

      // 5. Fetch Unit Quotas and Usage
      const settingsSnap = await getDocs(query(collection(db, 'quotaSettings'), where('month', '==', mKey)));
      let qSettings = { pjestotal: 100, opsTotal: 50 };
      if (!settingsSnap.empty) {
        qSettings = settingsSnap.docs[0].data() as any;
      }
      setUnitQuotas(qSettings);

      const logsSnap = await getDocs(query(collection(db, 'quotaLogs'), where('month', '==', mKey)));
      let pjesUsed = 0;
      let opsUsed = 0;
      logsSnap.docs.forEach(d => {
        const log = d.data();
        if (log.tipo === 'PJES') pjesUsed += log.quantidade;
        if (log.tipo === 'OPS') opsUsed += log.quantidade;
      });
      setCurrentUsage({ PJES: pjesUsed, OPS: opsUsed });

    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [currentMonth]);

  const handleDrop = async (info: any) => {
    if (!isAdmin) return;
    if (!selectedServiceId) {
      alert('Selecione um Tipo de Serviço antes de arrastar policiais.');
      return;
    }

    const policemanId = info.draggedEl.getAttribute('data-id');
    const date = info.date;
    const day = getDate(date);

    // Checks
    const isOrdinary = (ordinarySchedules[policemanId] || []).includes(day);
    if (isOrdinary) {
      alert('Impedido: O policial possui serviço ordinário nesta data.');
      return;
    }

    const volunteer = volunteers.find(v => v.policemanId === policemanId);
    const scaledCount = allEscalasOfMonth.filter(e => e.policemenIds.includes(policemanId)).length;
    if (volunteer && scaledCount >= volunteer.cotas) {
      alert('Limite atingido: O policial já atingiu sua cota de voluntariado.');
      return;
    }

    const alreadyOnScale = allEscalasOfMonth.some(e => 
      isSameDay(e.date.toDate(), date) && e.policemenIds.includes(policemanId)
    );
    if (alreadyOnScale) {
       alert('Alerta: O policial já está escalado nesta data.');
       return;
    }

    const service = services.find(s => s.id === selectedServiceId);
    if (!service) return;

    // Check Unit Quota
    const needed = service.cotasPorEscala || 1;
    const type = service.tipo as 'PJES' | 'OPS';
    const limit = unitQuotas?.[`${type.toLowerCase()}Total`] || 0;
    const used = currentUsage[type];

    if (used + needed > limit) {
      alert(`Erro: Cota de ${type} insuficiente na unidade. Restante: ${limit - used}`);
      return;
    }

    setSubmitting(true);
    try {
      const existingEscala = allEscalasOfMonth.find(e => 
        e.serviceTypeId === selectedServiceId && isSameDay(e.date.toDate(), date)
      );

      let escalaId = existingEscala?.id;

      if (existingEscala) {
        await updateDoc(doc(db, 'escalas', existingEscala.id!), {
          policemenIds: [...new Set([...existingEscala.policemenIds, policemanId])],
          updatedAt: serverTimestamp()
        });
      } else {
        const docRef = await addDoc(collection(db, 'escalas'), {
          serviceTypeId: selectedServiceId,
          policemenIds: [policemanId],
          date: Timestamp.fromDate(date),
          observations: '',
          createdAt: serverTimestamp()
        });
        escalaId = docRef.id;
      }

      // Register Quota Log
      await addDoc(collection(db, 'quotaLogs'), {
        serviceTypeId: selectedServiceId,
        serviceName: service.nome,
        escalaId: escalaId,
        tipo: type,
        quantidade: needed,
        usuarioUid: auth.currentUser?.uid,
        usuarioEmail: auth.currentUser?.email,
        data: serverTimestamp(),
        month: format(date, 'yyyy-MM')
      });

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
      fetchData();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'escalas');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSelect = async (info: any) => {
    if (!isAdmin || !selectedServiceId) return;
    
    // Check if we want to add multiple volunteers to a range or something
    // For now, let's keep it simple: drag and drop is primary.
    // But we can implement a "Select Range" then clicking a button to add selected PMs.
  };

  const handleEventClick = async (info: any) => {
    if (!isAdmin) return;
    if (info.event.display === 'background') return;

    setSelectedEvent({
      id: info.event.id,
      title: info.event.title,
      ...info.event.extendedProps
    });
  };

  const handleRemoveMember = async (escalaId: string, pId: string) => {
    if (!confirm(`Deseja remover este policial da escala? Este serviço não estornará a cota automaticamente.`)) return;
    
    const escala = allEscalasOfMonth.find(e => e.id === escalaId);
    if (!escala) return;

    try {
      if (escala.policemenIds.length <= 1) {
        await deleteDoc(doc(db, 'escalas', escalaId));
      } else {
        await updateDoc(doc(db, 'escalas', escalaId), {
          policemenIds: escala.policemenIds.filter(id => id !== pId)
        });
      }
      setSelectedEvent(null);
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDateClick = (info: any) => {
    if (!isAdmin) return;
    setQuickCreateDate(info.date);
  };

  const handleQuickCreateSubmit = async (pIds: string[]) => {
    if (!quickCreateDate || !selectedServiceId) return;
    
    const service = services.find(s => s.id === selectedServiceId);
    if (!service) return;

    const neededTotal = (service.cotasPorEscala || 1) * pIds.length;
    const type = service.tipo as 'PJES' | 'OPS';
    const limit = unitQuotas?.[`${type.toLowerCase()}Total`] || 0;
    const used = currentUsage[type];

    if (used + neededTotal > limit) {
      alert(`Erro: Cota de ${type} insuficiente na unidade para ${pIds.length} PMs. Restante: ${limit - used}`);
      return;
    }

    setSubmitting(true);
    try {
      const existingEscala = allEscalasOfMonth.find(e => 
        e.serviceTypeId === selectedServiceId && isSameDay(e.date.toDate(), quickCreateDate)
      );

      let escalaId = existingEscala?.id;

      if (existingEscala) {
        const mergedIds = [...new Set([...existingEscala.policemenIds, ...pIds])];
        await updateDoc(doc(db, 'escalas', existingEscala.id!), {
          policemenIds: mergedIds,
          updatedAt: serverTimestamp()
        });
      } else {
        const docRef = await addDoc(collection(db, 'escalas'), {
          serviceTypeId: selectedServiceId,
          policemenIds: pIds,
          date: Timestamp.fromDate(quickCreateDate),
          observations: '',
          createdAt: serverTimestamp()
        });
        escalaId = docRef.id;
      }

      // Register Quota Logs (one entry per PM added)
      for (const pId of pIds) {
        await addDoc(collection(db, 'quotaLogs'), {
          serviceTypeId: selectedServiceId,
          serviceName: service.nome,
          escalaId: escalaId,
          tipo: type,
          quantidade: service.cotasPorEscala || 1,
          usuarioUid: auth.currentUser?.uid,
          usuarioEmail: auth.currentUser?.email,
          data: serverTimestamp(),
          month: format(quickCreateDate, 'yyyy-MM')
        });
      }

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
      setQuickCreateDate(null);
      fetchData();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'escalas');
    } finally {
       setSubmitting(false);
    }
  };

  const getServiceIcon = (category: string) => {
    switch (category?.toUpperCase()) {
      case 'PATRULHA': return <Shield className="w-3 h-3" />;
      case 'GGI': return <Target className="w-3 h-3" />;
      case 'GUARDA': return <Lock className="w-3 h-3" />;
      case 'OPERAÇÃO': return <Zap className="w-3 h-3" />;
      case 'TÁTICO': return <Zap className="w-3 h-3" />;
      case 'SUPERVISÃO': return <Crown className="w-3 h-3" />;
      case 'ORDINÁRIO': return <Clock className="w-3 h-3" />;
      default: return <Briefcase className="w-3 h-3" />;
    }
  };

  const calculateFairnessScore = (v: Volunteer & { policeman?: Policeman }) => {
    const scaledCount = allEscalasOfMonth.filter(e => e.policemenIds.includes(v.policemanId)).length;
    const quotaRatio = (scaledCount + 1) / (v.cotas + 1); // Lower is higher priority
    const seniorityFactor = (v.policeman?.antiguidade || 999) / 10000;
    
    // Higher score = Higher priority (needed for scale)
    return (1 - quotaRatio) + (1 - seniorityFactor);
  };

  const checkIntersticio = (policemanId: string, targetDate: Date) => {
    const minHoursRest = 12;
    const sameDayEscalas = allEscalasOfMonth.filter(e => {
        const diff = Math.abs(e.date.toDate().getTime() - targetDate.getTime());
        return diff < minHoursRest * 60 * 60 * 1000;
    });
    return sameDayEscalas.length === 0;
  };

  const getPolicemanAvailability = (policemanId: string, day: number, date: Date) => {
    const isOrdinary = (ordinarySchedules[policemanId] || []).includes(day);
    if (isOrdinary) return { available: false, reason: 'Serviço Ordinário' };

    const volunteer = volunteers.find(v => v.policemanId === policemanId);
    if (!volunteer) return { available: false, reason: 'Não voluntário' };

    const scaledCount = allEscalasOfMonth.filter(e => e.policemenIds.includes(policemanId)).length;
    if (scaledCount >= volunteer.cotas) return { available: false, reason: 'Cota atingida' };

    const alreadyOnScale = allEscalasOfMonth.some(e => 
      isSameDay(e.date.toDate(), date) && e.policemenIds.includes(policemanId)
    );
    if (alreadyOnScale) return { available: false, reason: 'Já escalado neste dia' };

    const hasRest = checkIntersticio(policemanId, date);
    if (!hasRest) return { available: false, reason: 'Violação de Interstício (12h)' };

    return { available: true };
  };

  const suggestVolunteers = () => {
    if (!selectedServiceId) return [];
    
    return [...filteredVolunteers].sort((a, b) => {
      return calculateFairnessScore(b) - calculateFairnessScore(a);
    }).slice(0, 5);
  };

  const events = [
    // 1. Scaled Policemen
    ...allEscalasOfMonth.flatMap(e => {
        const s = services.find(srv => srv.id === e.serviceTypeId);
        if (calendarFilter !== 'ALL' && s?.tipo !== calendarFilter) return [];

        return e.policemenIds.map(pId => {
          const v = volunteers.find(vol => vol.policemanId === pId); 
          const p = v?.policeman;

          return {
            id: `${e.id}-${pId}`,
            title: p?.nomeGuerra || 'PM',
            start: format(e.date.toDate(), 'yyyy-MM-dd'),
            backgroundColor: s?.color || '#1e293b',
            borderColor: s?.color || '#1e293b',
            extendedProps: {
              escalaId: e.id,
              policemanId: pId,
              tipo: s?.tipo,
              categoria: s?.categoria,
              sigla: s?.sigla,
              serviceName: s?.nome,
              nomeGuerra: p?.nomeGuerra,
              matricula: p?.matricula,
              graduacao: p?.graduacaoPosto,
              cidade: s?.cidade,
              horario: `${s?.horarioInicio} - ${s?.horarioTermino}`,
              situacao: p?.situacao,
              cotasInfo: `${allEscalasOfMonth.filter(sc => sc.policemenIds.includes(pId)).length} / ${v?.cotas || 0}`
            }
          };
        });
    }),

    // 2. Service Demand Indicators (Slots)
    ...services.flatMap(s => {
      if (calendarFilter !== 'ALL' && s.tipo !== calendarFilter) return [];
      
      return (s.activeDates || []).map(dateStr => {
        const escToday = allEscalasOfMonth.find(e => e.serviceTypeId === s.id && format(e.date.toDate(), 'yyyy-MM-dd') === dateStr);
        const currentCount = escToday?.policemenIds.length || 0;
        const needed = s.vagasNecessarias || 2;
        const remaining = needed - currentCount;

        if (remaining <= 0) return null;

        return {
          id: `slot-${s.id}-${dateStr}`,
          title: `${s.sigla}: ${remaining} vagas`,
          start: dateStr,
          backgroundColor: 'transparent',
          textColor: s.color,
          borderColor: s.color,
          classNames: ['border-dashed', 'border-2'],
          extendedProps: {
            isSlot: true,
            serviceId: s.id,
            remaining,
            totalNeeded: needed,
            serviceName: s.nome,
            sigla: s.sigla
          }
        };
      }).filter(Boolean);
    }) as any[]
  ];

  // Highlight availability if a policeman is focused
  if (focusedPolicemanId && !assistedMode) {
    const days = eachDayOfInterval({
      start: startOfMonth(currentMonth),
      end: endOfMonth(currentMonth)
    });

    days.forEach(date => {
      const day = getDate(date);
      const { available } = getPolicemanAvailability(focusedPolicemanId, day, date);
      if (!available) {
        events.push({
          id: `unavail-${focusedPolicemanId}-${day}`,
          start: format(date, 'yyyy-MM-dd'),
          display: 'background',
          backgroundColor: 'rgba(239, 68, 68, 0.15)',
          extendedProps: { isUnavailable: true }
        } as any);
      }
    });
  }

  // Ordinary service markers
  if (calendarFilter === 'ALL' || calendarFilter === 'ORD') {
    Object.entries(ordinarySchedules).forEach(([pId, days]) => {
       days.forEach(day => {
          const p = volunteers.find(v => v.policemanId === pId)?.policeman;
          if (p) {
             events.push({
               id: `ord-${pId}-${day}`,
               title: `X ${p.nomeGuerra}`,
               start: format(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day), 'yyyy-MM-dd'),
               backgroundColor: '#dc2626',
               borderColor: '#b91c1c',
               display: 'background',
               extendedProps: { isOrdinary: true }
             } as any);
          }
       });
    });
  }

  const filteredVolunteers = volunteers.filter(v => {
    const scaledCount = allEscalasOfMonth.filter(e => e.policemenIds.includes(v.policemanId)).length;
    const available = (v.cotas || 0) - scaledCount;

    const matchesSearch = !searchTerm || v.policeman?.nomeGuerra.toLowerCase().includes(searchTerm.toLowerCase()) || v.policeman?.matricula.includes(searchTerm);
    const matchesType = filterType === 'ALL' || v.type === filterType;
    const matchesPlatoon = filterPlatoon === 'ALL' || v.policeman?.pelotao === filterPlatoon;
    const matchesAvailable = !filterOnlyAvailable || available > 0;

    return matchesSearch && matchesType && matchesPlatoon && matchesAvailable;
  });

  if (!isAdmin) return <div className="text-center py-20 text-xs font-black uppercase text-slate-400 italic font-sans">Acesso restrito ao P/1.</div>;

  return (
    <div className="flex flex-col lg:flex-row gap-6 h-[calc(100vh-120px)]">
      {/* Sidebar: Volunteers */}
      <motion.div 
        initial={{ x: -20, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        className="w-full lg:w-96 flex flex-col bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden shrink-0"
      >
        <div className="p-5 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center justify-between mb-5">
             <div>
                <h3 className="text-xs font-black text-pmpe-navy uppercase tracking-widest flex items-center gap-2">
                   <Users className="w-4 h-4 text-pmpe-gold" /> Painel de Voluntários
                </h3>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter mt-1">Arraste para o calendário</p>
             </div>
             <div className="bg-pmpe-navy text-white text-[9px] font-black px-2.5 py-1 rounded-lg">
                {filteredVolunteers.length}
             </div>
          </div>

          <div className="space-y-3">
             <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input 
                  type="text"
                  placeholder="Nome ou Matrícula..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-2xl text-[11px] font-bold outline-none font-sans focus:ring-2 focus:ring-pmpe-navy/5 shadow-sm"
                />
             </div>
             
             <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                {['ALL', 'PJES', 'OPS'].map((type) => (
                   <button 
                     key={type}
                     onClick={() => setFilterType(type as any)}
                     className={cn(
                       "px-3 py-1.5 rounded-xl text-[9px] font-black uppercase whitespace-nowrap transition-all border",
                       filterType === type 
                        ? "bg-pmpe-navy text-white border-pmpe-navy shadow-md" 
                        : "bg-white text-slate-400 border-slate-200 hover:border-slate-300"
                     )}
                   >{type === 'ALL' ? 'Todos' : type}</button>
                ))}
                <button 
                   onClick={() => setFilterOnlyAvailable(!filterOnlyAvailable)}
                   className={cn(
                     "px-3 py-1.5 rounded-xl text-[9px] font-black uppercase whitespace-nowrap transition-all border flex items-center gap-1",
                     filterOnlyAvailable ? "bg-emerald-600 text-white border-emerald-600 shadow-md" : "bg-white text-slate-400 border-slate-200"
                   )}
                >
                   <CheckCircle2 className="w-3 h-3" /> Disp.
                </button>
             </div>

             <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                {['ALL', '1º PEL', '2º PEL', '3º PEL', 'GATI'].map((plt) => (
                   <button 
                     key={plt}
                     onClick={() => setFilterPlatoon(plt)}
                     className={cn(
                       "px-2.5 py-1.5 rounded-xl text-[8px] font-black uppercase whitespace-nowrap transition-all border",
                       filterPlatoon === plt 
                        ? "bg-slate-200 text-slate-800 border-slate-300 shadow-inner" 
                        : "bg-white text-slate-400 border-slate-100 font-bold"
                     )}
                   >{plt}</button>
                ))}
             </div>
          </div>
        </div>

        <div id="external-volunteers" className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
           <div className="flex items-center justify-between px-1 mb-2">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Policiais Aptos</span>
              <button 
                onClick={() => setAssistedMode(!assistedMode)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[9px] font-black uppercase transition-all shadow-sm",
                  assistedMode ? "bg-pmpe-gold text-white" : "bg-white text-pmpe-gold border border-pmpe-gold/20"
                )}
              >
                 <Zap className={cn("w-3 h-3", assistedMode && "fill-white")} /> Assistido
              </button>
           </div>

           {loading ? (
             <div className="flex flex-col items-center justify-center h-40 opacity-30">
               <div className="w-10 h-10 border-4 border-pmpe-navy border-t-transparent rounded-full animate-spin mb-3" />
               <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Sincronizando...</p>
             </div>
           ) : filteredVolunteers.length === 0 ? (
             <div className="flex flex-col items-center justify-center py-20 opacity-30">
               <Users className="w-12 h-12 mb-2 text-slate-300" />
               <p className="text-[11px] font-black text-slate-400 uppercase italic">Nenhum voluntário</p>
             </div>
           ) : (
             (assistedMode ? suggestVolunteers() : filteredVolunteers).map(v => {
                const scaledCount = allEscalasOfMonth.filter(e => e.policemenIds.includes(v.policemanId)).length;
                const available = (v.cotas || 0) - scaledCount;
                const isLimit = available <= 0;
                const isNear = available > 0 && available <= 2;
                const isFocused = focusedPolicemanId === v.policemanId;

                return (
                  <div 
                    key={v.id}
                    data-id={v.policemanId}
                    data-name={v.policeman?.nomeGuerra || 'PM'}
                    onMouseEnter={() => setFocusedPolicemanId(v.policemanId)}
                    onMouseLeave={() => setFocusedPolicemanId(null)}
                    className={cn(
                      "fc-event p-3.5 rounded-2xl border transition-all relative group overflow-hidden bg-white",
                      isLimit 
                        ? "opacity-40 grayscale pointer-events-none bg-slate-50 border-slate-100" 
                        : "cursor-grab active:cursor-grabbing border-slate-100 hover:border-pmpe-navy/30 hover:shadow-xl hover:-translate-y-0.5",
                      isFocused && "ring-2 ring-pmpe-navy ring-offset-2 border-pmpe-navy/30"
                    )}
                  >
                    {isFocused && (
                      <div className="absolute top-0 right-0 p-1.5">
                         <Eye className="w-3 h-3 text-pmpe-navy opacity-30" />
                      </div>
                    )}
                    <div className="flex justify-between items-start mb-3">
                       <div className="flex gap-3">
                          <div className={cn(
                            "w-10 h-10 rounded-xl flex items-center justify-center text-[10px] font-black shrink-0 shadow-sm transition-colors",
                            v.type === 'PJES' ? "bg-slate-100 text-slate-800" : "bg-orange-50 text-orange-700"
                          )}>
                             {v.policeman?.graduacaoPosto.substring(0, 2)}
                          </div>
                          <div className="flex-1 min-w-0">
                             <p className="text-[11px] font-black text-slate-800 uppercase tracking-tight truncate leading-tight">{v.policeman?.nomeGuerra}</p>
                             <div className="flex items-center gap-2 mt-0.5">
                                <p className="text-[9px] font-bold text-slate-400">Mat: {v.policeman?.matricula}</p>
                                <span className={cn(
                                   "px-1 rounded text-[7px] font-black uppercase tracking-tighter",
                                   v.policeman?.situacao === 'ATIVO' ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"
                                )}>{v.policeman?.situacao}</span>
                             </div>
                          </div>
                       </div>
                       <div className={cn(
                          "w-2.5 h-2.5 rounded-full",
                          isLimit ? "bg-red-500" : isNear ? "bg-amber-500" : "bg-emerald-500 outline outline-4 outline-emerald-500/10"
                       )} />
                    </div>

                    <div className="grid grid-cols-3 gap-2 py-3 border-y border-slate-50 bg-slate-50/50 -mx-3.5 px-3.5 mb-2">
                       <div className="text-center">
                          <p className="text-[8px] font-bold text-slate-400 uppercase mb-1">Cotas</p>
                          <p className="text-[12px] font-black text-slate-800">{v.cotas}</p>
                       </div>
                       <div className="text-center">
                          <p className="text-[8px] font-bold text-slate-400 uppercase mb-1">Score</p>
                          <p className="text-[12px] font-black text-pmpe-navy">{Math.round(calculateFairnessScore(v) * 100)}</p>
                       </div>
                       <div className="text-center">
                          <p className="text-[8px] font-bold text-slate-400 uppercase mb-1">Dispon.</p>
                          <p className={cn("text-[12px] font-black", available > 0 ? "text-emerald-600" : "text-red-500")}>{available}</p>
                       </div>
                    </div>

                    <div className="flex items-center justify-between">
                       <span className="text-[8px] font-black text-slate-300 uppercase tracking-widest">{v.policeman?.pelotao}</span>
                       <div className="flex gap-2">
                          {assistedMode && <Crown className="w-3.5 h-3.5 text-pmpe-gold" />}
                          {v.policeman?.isMotorista && <Car className="w-3.5 h-3.5 text-purple-400" />}
                       </div>
                    </div>
                  </div>
                );
             })
           )}
        </div>
      </motion.div>

      {/* Main Area: Calendar */}
      <motion.div 
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="flex-1 flex flex-col bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden"
      >
        <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-6 bg-slate-50/40">
          <div className="flex items-center gap-6">
             <div className="flex bg-white p-1 rounded-2xl border border-slate-200 shadow-sm ring-4 ring-slate-100">
                <button 
                  onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                  className="p-2 hover:bg-slate-50 rounded-xl text-slate-400 transition-colors"
                ><ChevronLeft className="w-5 h-5" /></button>
                <div className="px-6 flex items-center justify-center min-w-[160px]">
                   <span className="text-sm font-black text-pmpe-navy uppercase tracking-[0.1em]">{format(currentMonth, 'MMMM / yyyy', { locale: ptBR })}</span>
                </div>
                <button 
                  onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                  className="p-2 hover:bg-slate-50 rounded-xl text-slate-400 transition-colors"
                ><ChevronRight className="w-5 h-5" /></button>
             </div>

             <div className="hidden xl:flex items-center gap-4 bg-white/50 px-4 py-2 rounded-2xl border border-slate-100">
                {['ALL', 'PJES', 'OPS', 'ORD'].map((f) => (
                   <button 
                     key={f}
                     onClick={() => setCalendarFilter(f as any)}
                     className={cn(
                       "flex items-center gap-2 px-2 py-1 rounded-lg transition-all",
                       calendarFilter === f ? "bg-pmpe-navy text-white" : "hover:bg-slate-100"
                     )}
                   >
                     <div className={cn(
                       "w-2.5 h-2.5 rounded",
                       f === 'PJES' ? "bg-slate-800" : f === 'OPS' ? "bg-green-600" : f === 'ORD' ? "bg-red-600" : "bg-slate-300"
                     )} />
                     <span className="text-[9px] font-black uppercase">{f === 'ALL' ? 'Tudo' : f}</span>
                   </button>
                ))}
             </div>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
             <div className="relative flex-1 sm:w-80">
                <Briefcase className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-pmpe-gold" />
                <select 
                  value={selectedServiceId}
                  onChange={(e) => setSelectedServiceId(e.target.value)}
                  className={cn(
                    "w-full pl-12 pr-4 py-3 border rounded-2xl text-[10px] font-black uppercase tracking-widest outline-none transition-all appearance-none cursor-pointer shadow-sm",
                    !selectedServiceId ? "bg-amber-50 border-amber-200 text-amber-700" : "bg-white border-slate-200 text-pmpe-navy focus:ring-4 focus:ring-pmpe-navy/5"
                  )}
                >
                   <option value="">-- SELECIONE O SERVIÇO ATIVO --</option>
                   {services.map(s => (
                     <option key={s.id} value={s.id}>{s.tipo} • {s.nome} ({s.cidade})</option>
                   ))}
                </select>
             </div>
          </div>
        </div>

        <div className="flex-1 overflow-hidden p-6 custom-calendar-container bg-white">
           <FullCalendar
             ref={calendarRef}
             plugins={[dayGridPlugin, interactionPlugin, listPlugin]}
             initialView="dayGridMonth"
             headerToolbar={false}
             locale={ptBR}
             events={events}
             editable={isAdmin}
             droppable={isAdmin}
             selectable={isAdmin}
             select={handleSelect}
             drop={handleDrop}
             eventClick={handleEventClick}
             dateClick={handleDateClick}
             height="100%"
             dayMaxEvents={3}
             fixedWeekCount={false}
             validRange={{
                start: format(startOfMonth(currentMonth), 'yyyy-MM-dd'),
                end: format(addMonths(endOfMonth(currentMonth), 1), 'yyyy-MM-dd')
             }}
             eventContent={(arg) => {
                if (arg.event.extendedProps.isUnavailable) {
                  return { html: `<div class="w-full h-full flex items-center justify-center bg-red-500/10"><X class="w-4 h-4 text-red-500/30" /></div>` };
                }
                if (arg.event.extendedProps.isOrdinary) {
                   return { html: `<div class="bg-red-500 text-white text-[9px] font-black uppercase text-center py-1 rounded-md border border-red-600 shadow-sm">ORD</div>` };
                }
                const isPJES = arg.event.extendedProps.tipo === 'PJES';
                const sigla = arg.event.extendedProps.sigla || arg.event.extendedProps.tipo;
                const categoria = arg.event.extendedProps.categoria || '';
                
                return (
                   <div className="px-2 py-1.5 rounded-lg border border-white/20 text-[10px] font-black uppercase text-white shadow-lg truncate flex items-center gap-1.5" style={{ backgroundColor: arg.event.backgroundColor }}>
                      <span className="bg-white/20 px-1 rounded text-[8px]">{sigla}</span>
                      {getServiceIcon(categoria)}
                      <span className="truncate">{arg.event.title}</span>
                   </div>
                );
             }}
             dayCellContent={(arg) => {
               const day = parseInt(arg.dayNumberText);
               const date = arg.date;
               const scalesToday = allEscalasOfMonth.filter(e => isSameDay(e.date.toDate(), date));
               const totalPmToday = scalesToday.reduce((acc, e) => acc + e.policemenIds.length, 0);
               
               // Target coverage (example: 10 PMs per day across all services)
               const targetCoverage = 8;
               const coveragePercent = Math.min((totalPmToday / targetCoverage) * 100, 100);

               return (
                  <div className="flex flex-col items-center justify-center w-full relative">
                     <span className={cn(
                       "text-[12px] font-black relative z-10",
                       arg.isToday ? "text-pmpe-navy" : "text-slate-400"
                     )}>{arg.dayNumberText}</span>
                     
                     <div className="absolute inset-x-2 bottom-[-10px] h-1 bg-slate-100 rounded-full overflow-hidden">
                        <div 
                           className={cn(
                              "h-full transition-all duration-500",
                              coveragePercent >= 100 ? "bg-emerald-500" : coveragePercent > 50 ? "bg-pmpe-gold" : "bg-slate-300"
                           )}
                           style={{ width: `${coveragePercent}%` }}
                        />
                     </div>
                  </div>
               );
             }}
           />
        </div>
      </motion.div>

      <AnimatePresence>
        {selectedEvent && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-[32px] w-full max-w-lg overflow-hidden shadow-2xl border border-white/20"
            >
               <div className="relative h-32 bg-pmpe-navy p-8">
                  <div className="absolute top-6 right-6">
                     <button 
                       onClick={() => setSelectedEvent(null)}
                       className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
                     ><X className="w-5 h-5" /></button>
                  </div>
                  <div className="flex items-center gap-4">
                     <div className="w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center backdrop-blur-md">
                        {getServiceIcon(selectedEvent.categoria)}
                     </div>
                     <div>
                        <h2 className="text-white font-black text-xl uppercase tracking-tighter leading-tight">{selectedEvent.serviceName}</h2>
                        <div className="flex items-center gap-2 mt-1">
                           <span className="bg-pmpe-gold text-pmpe-navy text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-widest">{selectedEvent.sigla}</span>
                           <span className="text-white/50 text-[10px] font-bold uppercase tracking-widest">{selectedEvent.cidade}</span>
                        </div>
                     </div>
                  </div>
               </div>

               <div className="p-8">
                  <div className="grid grid-cols-1 gap-6">
                     <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center border border-slate-200 text-[12px] font-black text-pmpe-navy shadow-sm">
                           {selectedEvent.graduacao?.substring(0, 2)}
                        </div>
                        <div>
                           <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Policial Escalado</p>
                           <p className="text-sm font-black text-slate-800 uppercase leading-none">{selectedEvent.nomeGuerra}</p>
                           <p className="text-[10px] font-bold text-slate-400 mt-1 italic">Matrícula: {selectedEvent.matricula}</p>
                        </div>
                     </div>

                     <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 rounded-2xl bg-slate-50/50 border border-slate-100">
                           <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                              <Clock className="w-3 h-3 text-pmpe-navy" /> Horário
                           </p>
                           <p className="text-xs font-black text-slate-800">{selectedEvent.horario}</p>
                        </div>
                        <div className="p-4 rounded-2xl bg-slate-50/50 border border-slate-100">
                           <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                              <Smartphone className="w-3 h-3 text-pmpe-navy" /> Situação
                           </p>
                           <span className={cn(
                              "text-[10px] font-black px-2 py-1 rounded-lg uppercase",
                              selectedEvent.situacao === 'ATIVO' ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"
                           )}>{selectedEvent.situacao}</span>
                        </div>
                     </div>

                     <div className="flex items-center justify-between p-4 bg-emerald-50/50 rounded-2xl border border-emerald-100">
                        <div className="flex items-center gap-3 font-sans">
                           <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
                              <CheckCircle2 className="w-5 h-5 text-white" />
                           </div>
                           <div>
                              <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest leading-none mb-1">Cotas Utilizadas</p>
                              <p className="text-lg font-black text-emerald-700 leading-none">{selectedEvent.cotasInfo}</p>
                           </div>
                        </div>
                        <div className="text-right">
                           <p className="text-[10px] font-bold text-emerald-600/50 uppercase tracking-widest">Saldo Mensal</p>
                        </div>
                     </div>
                  </div>

                  <div className="mt-8 flex gap-3">
                     <button 
                       onClick={() => handleRemoveMember(selectedEvent.escalaId, selectedEvent.policemanId)}
                       className="flex-1 py-4 bg-red-50 hover:bg-red-100 text-red-600 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                     >
                        <Trash2 className="w-4 h-4" /> Remover Membro
                     </button>
                     <button 
                       onClick={() => setSelectedEvent(null)}
                       className="flex-1 py-4 bg-pmpe-navy text-white rounded-2xl text-[11px] font-black uppercase tracking-widest shadow-xl shadow-pmpe-navy/20 hover:-translate-y-0.5 transition-all"
                     >
                        Confirmar
                     </button>
                  </div>
               </div>
            </motion.div>
          </div>
        )}

        {quickCreateDate && (
           <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
             <motion.div
               initial={{ scale: 0.9, opacity: 0 }}
               animate={{ scale: 1, opacity: 1 }}
               exit={{ scale: 0.9, opacity: 0 }}
               className="bg-white rounded-[32px] w-full max-w-2xl overflow-hidden shadow-2xl border border-white/20"
             >
                <div className="p-8 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                   <div>
                      <h2 className="text-pmpe-navy font-black text-lg uppercase tracking-tight">Escala para {format(quickCreateDate, "dd 'de' MMMM", { locale: ptBR })}</h2>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                         Selecione o serviço e os voluntários disponíveis
                      </p>
                   </div>
                   <button onClick={() => setQuickCreateDate(null)} className="p-2 hover:bg-slate-200 rounded-xl transition-colors">
                      <X className="w-5 h-5 text-slate-400" />
                   </button>
                </div>

                <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-8 max-h-[70vh] overflow-y-auto">
                   <div className="space-y-4">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Serviços Ativos Hoje</label>
                      <div className="space-y-2">
                        {services.filter(s => (s.activeDates || []).includes(format(quickCreateDate, 'yyyy-MM-dd'))).map(s => (
                          <button
                            key={s.id}
                            onClick={() => setSelectedServiceId(s.id!)}
                            className={cn(
                              "w-full p-4 rounded-2xl border flex items-center gap-3 transition-all text-left",
                              selectedServiceId === s.id 
                                ? "bg-pmpe-navy border-pmpe-navy text-white shadow-lg" 
                                : "bg-white border-slate-100 hover:border-pmpe-navy/20"
                            )}
                          >
                             <div className={cn(
                               "w-8 h-8 rounded-lg flex items-center justify-center",
                               selectedServiceId === s.id ? "bg-white/20" : "bg-slate-100"
                             )}>
                                {getServiceIcon(s.categoria)}
                             </div>
                             <div>
                                <p className="text-[11px] font-black uppercase leading-tight">{s.nome}</p>
                                <p className={cn("text-[9px] font-bold mt-0.5", selectedServiceId === s.id ? "text-white/60" : "text-slate-500")}>
                                  {s.tipo} • {s.horarioInicio} - {s.horarioTermino}
                                </p>
                             </div>
                          </button>
                        ))}
                      </div>
                   </div>

                   <div className="space-y-4">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Voluntários Aptos</label>
                      <div className="space-y-2">
                         {suggestVolunteers().map(v => {
                            const { available, reason } = getPolicemanAvailability(v.policemanId, getDate(quickCreateDate), quickCreateDate);
                            const currentType = services.find(s => s.id === selectedServiceId)?.tipo;
                            const isTypeMatch = !selectedServiceId || v.type === currentType;

                            return (
                               <button 
                                 key={v.id}
                                 disabled={!available || !selectedServiceId || !isTypeMatch}
                                 onClick={() => handleQuickCreateSubmit([v.policemanId])}
                                 className={cn(
                                   "w-full p-4 rounded-2xl border flex items-center justify-between transition-all group",
                                   available && selectedServiceId && isTypeMatch
                                    ? "bg-white border-slate-100 hover:border-pmpe-navy/30 hover:bg-slate-50" 
                                    : "bg-slate-50 border-slate-100 opacity-50 grayscale cursor-not-allowed"
                                 )}
                               >
                                  <div className="flex items-center gap-3 text-left">
                                     <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-[10px] font-black text-slate-500 group-hover:bg-pmpe-navy group-hover:text-white transition-colors">
                                        {v.policeman?.graduacaoPosto.substring(0, 2)}
                                     </div>
                                     <div>
                                        <p className="text-[11px] font-black text-slate-800 uppercase leading-none">{v.policeman?.nomeGuerra}</p>
                                        <p className="text-[9px] font-bold text-slate-400 mt-1">{available && isTypeMatch ? `Cotas: ${v.cotas}` : reason || 'Tipo divergente'}</p>
                                     </div>
                                  </div>
                                  {available && selectedServiceId && isTypeMatch && <Plus className="w-4 h-4 text-pmpe-navy opacity-0 group-hover:opacity-100 transition-opacity" />}
                               </button>
                            );
                         })}
                      </div>
                   </div>
                </div>

                <div className="p-8 bg-slate-50 border-t border-slate-100 flex gap-3">
                   <button 
                     onClick={() => setQuickCreateDate(null)}
                     className="flex-1 py-4 text-[11px] font-black text-slate-400 uppercase tracking-widest"
                   >Cancelar</button>
                </div>
             </motion.div>
           </div>
        )}

        {success && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.9 }}
            className="fixed bottom-10 right-10 bg-pmpe-navy text-white px-8 py-4 rounded-3xl shadow-2xl z-50 flex items-center gap-4 border border-white/10"
          >
            <div className="w-10 h-10 bg-emerald-500 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <CheckCircle2 className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-sm font-black uppercase tracking-tighter">Base Atualizada</p>
              <p className="text-[10px] font-bold text-white/50 uppercase tracking-widest mt-0.5">As cotas foram recalculadas com sucesso.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-calendar-container .fc {
          --fc-border-color: #f1f5f9;
          --fc-daygrid-event-dot-width: 8px;
          --fc-page-bg-color: transparent;
          font-family: inherit;
        }
        .custom-calendar-container .fc-daygrid-day:hover {
          background-color: #f8fafc;
        }
        .custom-calendar-container .fc-col-header-cell {
          padding: 16px 0;
          background: #f8fafc;
          border-bottom: 2px solid #e2e8f0;
        }
        .custom-calendar-container .fc-col-header-cell-cushion {
          font-size: 11px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.15em;
          color: #64748b;
          text-decoration: none !important;
        }
        .custom-calendar-container .fc-daygrid-day-number {
          padding: 8px 12px;
          font-weight: 900;
          font-size: 13px;
          color: #94a3b8;
          text-decoration: none !important;
          transition: color 0.3s;
        }
        .custom-calendar-container .fc-daygrid-day.fc-day-today .fc-daygrid-day-number {
          color: #1e293b;
          background: #f1f5f9;
          border-radius: 0 0 12px 12px;
        }
        .custom-calendar-container .fc-day-today {
          background: #f8fafc !important;
        }
        .custom-calendar-container .fc-event {
          border-radius: 10px;
          margin: 2px 4px;
          cursor: pointer;
          border: none !important;
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .custom-calendar-container .fc-event:hover {
          transform: scale(1.02);
          box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1);
          z-index: 50;
        }
        .custom-calendar-container .fc-daygrid-day-frame {
          min-height: 120px;
        }
        .custom-calendar-container .fc-bg-event {
          opacity: 1 !important;
        }
        .custom-calendar-container .fc-day-other {
          background: #fbfbfc !important;
          opacity: 0.4;
        }
        .custom-calendar-container .fc-daygrid-day-top {
          flex-direction: row;
        }
        .fc-daygrid-event-harness {
           margin-bottom: 2px;
        }
      `}</style>
    </div>
  );
};

export default CreateEscala;
