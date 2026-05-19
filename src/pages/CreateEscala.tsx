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
  DndContext, 
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { 
  X, 
  Search, 
  Users,
  AlertCircle,
  Clock,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  ArrowDown,
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
  FileSpreadsheet,
  GripVertical,
  Sparkles,
  Undo2,
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
  const [aiLoading, setAiLoading] = useState(false);
  const [undoStack, setUndoStack] = useState<{ 
    action: 'ASSIGN' | 'REMOVE' | 'BATCH_AI', 
    data: {
      serviceId?: string,
      policemanId?: string,
      date?: Date,
      escalaId?: string,
      batch?: { action: 'ASSIGN' | 'REMOVE', serviceId: string, policemanId: string, date: Date, escalaId?: string }[]
    } 
  }[]>([]);
  const [duplicating, setDuplicating] = useState(false);
  const [success, setSuccess] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'PJES' | 'OPS'>('PJES');
  const [sortBy, setSortBy] = useState<'graduacaoPosto' | 'matricula' | 'nomeGuerra' | 'antiguidade' | 'order'>('order');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

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
        e.service?.tipo?.toUpperCase() === service.tipo?.toUpperCase()
      ).reduce((acc, e) => acc + Number(e.service?.cotasPorServico || 1), 0);
      
      if (scaledCount >= Number(v.cotas || 0) && service.tipo === 'PJES') return false;

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


  const handleAssignService = async (serviceId: string, customAssignInfo?: { policemanId: string, date: Date }, isUndo = false, isSilent = false) => {
    if (submitting) return false; 
    
    const assignInfo = customAssignInfo || assignmentModal;
    if (!assignInfo || !isAdmin) return false;
    
    const { policemanId, date } = assignInfo;
    const service = services.find(s => s.id === serviceId);
    if (!service) return false;

    const dateStr = format(date, 'yyyy-MM-dd');
    const needed = service.cotasPorServico || 1;
    
    // Skip validations if it's an UNDO operation (redundant but safe)
    if (!isUndo) {
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

      // 0. Ordinary Service Conflict Check
      const dayNum = getDate(date);
      const isOrdinary = (ordinarySchedules[policemanId] || []).includes(dayNum);
      if (isOrdinary) {
        if (!isSilent) alert(`Erro: O policial já está escalado no Serviço Ordinário nesta data. Não é permitido escala extra em dias de serviço ordinário.`);
        return false;
      }

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
         if (!isSilent) alert(`Conflito de Horário! O policial já está escalado no serviço ${overlappingScale.service?.sigla} (${overlappingScale.service?.horarioInicio}-${overlappingScale.service?.horarioTermino}) que choca com este horário.`);
         return false;
      }

      // 2. Strict Duplication Check
      const typeBeingAssigned = service.tipo; 
      const alreadyScaledInSameType = joinedEscalas.find(e => 
        format(e.date.toDate(), 'yyyy-MM-dd') === dateStr && 
        e.policemenIds.includes(policemanId) &&
        e.service?.tipo === typeBeingAssigned
      );

      if (alreadyScaledInSameType && typeBeingAssigned === 'PJES') {
         if (!isSilent) alert(`Este policial já possui uma escala de PJES para este dia (${alreadyScaledInSameType.service?.sigla}).`);
         return false;
      }

      // 3. Quota Check for the Policeman
      if (typeBeingAssigned !== 'OPS') {
        const volunteer = joinedVolunteers.find(v => v.policemanId === policemanId && v.type?.toUpperCase() === typeBeingAssigned?.toUpperCase());
        const maxAllowedQuotas = Number(volunteer?.cotas || 0);
        
        const currentMonthCotasUsed = joinedEscalas.filter(e => 
          e.policemenIds.includes(policemanId) && 
          e.service?.tipo?.toUpperCase() === typeBeingAssigned?.toUpperCase()
        ).reduce((acc, e) => acc + Number(e.service?.cotasPorServico || 1), 0);

        const neededValue = Number(needed);

        if (currentMonthCotasUsed + neededValue > maxAllowedQuotas) {
          if (!isSilent) alert(`Erro: O policial já atingiu ou excederá o seu limite de cotas voluntárias (${maxAllowedQuotas}). Já possui ${currentMonthCotasUsed} cotas e está tentando adicionar um serviço que consome ${neededValue}.`);
          return false;
        }
      }

      const existingEscalaCheck = joinedEscalas.find(e => 
        e.serviceTypeId === serviceId && format(e.date.toDate(), 'yyyy-MM-dd') === dateStr
      );

      // 4. Vacancy Check
      const currentSlotsUsed = existingEscalaCheck?.policemenIds.length || 0;
      const maxSlots = service.vagasNecessarias || 0; 

      if (maxSlots > 0 && currentSlotsUsed >= maxSlots) {
        if (!isSilent) alert(`Erro: Todas as vagas (${maxSlots}) para o serviço ${service.sigla} nesta data já foram preenchidas.`);
        return false;
      }

      const type = service.tipo as 'PJES' | 'OPS';
      
      let limit = 0;
      let used = 0;
      if (type === 'OPS') { 
        limit = 0; 
      }
      else {
        const subtype = service.pjesSubtype;
        if (subtype === 'MP') { limit = unitQuotas?.pjesMPTotal || 0; used = currentUsage.PJES_MP; }
        else if (subtype === 'FORUM') { limit = unitQuotas?.pjesForumTotal || 0; used = currentUsage.PJES_FORUM; }
        else if (subtype === 'ESCOLAR') { limit = unitQuotas?.pjesEscolarTotal || 0; used = currentUsage.PJES_ESCOLAR; }
        else if (subtype === 'DECRETO') { limit = unitQuotas?.pjesDecretoTotal || 0; used = currentUsage.PJES_DECRETO; }
      }

      if (limit > 0 && used + needed > limit) {
        if (!isSilent) alert(`Erro: Cota da UNIDADE insuficiente para ${service.sigla}.`);
        return false;
      }
    }

    const existingEscala = joinedEscalas.find(e => 
      e.serviceTypeId === serviceId && format(e.date.toDate(), 'yyyy-MM-dd') === dateStr
    );

    setSubmitting(true);
    try {
      let finalEscalaIdValue = '';
      if (existingEscala) {
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

      if (!isUndo && !isSilent) {
        setUndoStack(prev => [{ 
          action: 'ASSIGN', 
          data: { serviceId, policemanId, date, escalaId: finalEscalaIdValue } 
        }, ...prev.slice(0, 19)]);
      }

      if (!customAssignInfo) {
         setAssignmentModal(null);
      }
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
      return true;
    } catch (err) {
      console.error("Erro ao salvar escala:", err);
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveFromScale = async (escalaId: string, policemanId: string, isUndo = false) => {
    if (!isAdmin) return;
    const escala = joinedEscalas.find(e => e.id === escalaId);
    if (!escala) return;

    setLoading(true);
    try {
      // Keep record for undo before deleting
      const serviceId = escala.serviceTypeId;
      const date = escala.date.toDate();

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
      
      if (!isUndo) {
        setUndoStack(prev => [{ 
          action: 'REMOVE', 
          data: { serviceId, policemanId, date, escalaId } 
        }, ...prev.slice(0, 19)]);
      }

      setAssignmentModal(null);
    } catch (err) {
      console.error("Erro ao remover da escala:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleUndo = async () => {
    if (undoStack.length === 0 || submitting || loading) return;
    
    const lastOp = undoStack[0];
    const rest = undoStack.slice(1);
    
    setUndoStack(rest);

    if (lastOp.action === 'ASSIGN' && lastOp.data.serviceId && lastOp.data.policemanId && lastOp.data.date) {
      const escala = joinedEscalas.find(e => 
        e.serviceTypeId === lastOp.data.serviceId && 
        isSameDay(e.date.toDate(), lastOp.data.date) &&
        e.policemenIds.includes(lastOp.data.policemanId!)
      );
      if (escala) {
        await handleRemoveFromScale(escala.id!, lastOp.data.policemanId!, true);
      }
    } else if (lastOp.action === 'REMOVE' && lastOp.data.serviceId && lastOp.data.policemanId && lastOp.data.date) {
      await handleAssignService(lastOp.data.serviceId, { 
        policemanId: lastOp.data.policemanId, 
        date: lastOp.data.date 
      }, true);
    } else if (lastOp.action === 'BATCH_AI' && lastOp.data.batch) {
      // Create a batch of deletions for all assignments in the AI batch
      setLoading(true);
      try {
        for (const item of lastOp.data.batch) {
          const escala = joinedEscalas.find(e => 
            e.serviceTypeId === item.serviceId && 
            isSameDay(e.date.toDate(), item.date) &&
            e.policemenIds.includes(item.policemanId)
          );
          if (escala) {
            await handleRemoveFromScale(escala.id!, item.policemanId, true);
          }
        }
      } catch (err) {
        console.error("Erro no desfazer em lote:", err);
      } finally {
        setLoading(false);
      }
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (over && active.id !== over.id) {
      const oldIndex = filteredVolunteers.findIndex(v => v.id === active.id);
      const newIndex = filteredVolunteers.findIndex(v => v.id === over.id);
      
      const newOrder = arrayMove(filteredVolunteers, oldIndex, newIndex);
      
      // Update locally first for smooth UI
      setVolunteers(prev => {
        const updated = [...prev];
        newOrder.forEach((v, index) => {
          const found = updated.find(uv => uv.id === v.id);
          if (found) {
            found.order = index;
          }
        });
        return updated;
      });

      // Persist to Firestore
      setSubmitting(true);
      try {
        const writeBatch = (await import('firebase/firestore')).writeBatch;
        const batch = writeBatch(db);
        
        newOrder.forEach((v, index) => {
          if (v.id) {
            batch.update(doc(db, 'volunteers', v.id), { order: index });
          }
        });
        
        await batch.commit();
      } catch (err) {
        console.error("Erro ao reordenar:", err);
      } finally {
        setSubmitting(false);
      }
    }
  };

  const [aiProgress, setAiProgress] = useState<{ current: number, total: number } | null>(null);

  const handleRemoteAISchedule = async (fairMode = false) => {
    if (!isAdmin || aiLoading) return;
    
    const confirmMsg = fairMode 
      ? "Deseja utilizar a Inteligência Artificial para realizar uma DISTRIBUIÇÃO JUSTA? A IA tentará equilibrar o número de escalas para todos os voluntários, ignorando a antiguidade."
      : "Deseja utilizar a Inteligência Artificial para sugerir escalas para as vagas ociosas? As regras de antiguidade, cotas e conflitos serão respeitadas.";

    if (!window.confirm(confirmMsg)) return;

    setAiLoading(true);
    setAiProgress(null);
    try {
      const response = await fetch('/api/ai/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          volunteers: joinedVolunteers.map(v => ({
            policemanId: v.policemanId,
            nomeGuerra: v.policeman?.nomeGuerra,
            antiguidade: v.policeman?.antiguidade,
            cotas: v.cotas,
            type: v.type
          })),
          services: services.filter(s => {
            const matchesMonth = s.month === mKey;
            // If fairMode is true, we might want to ONLY distribute for the current activeTab type
            if (fairMode) {
               return matchesMonth && s.tipo?.toUpperCase() === activeTab;
            }
            return matchesMonth;
          }).map(s => ({
            id: s.id,
            sigla: s.sigla,
            nome: s.nome,
            tipo: s.tipo,
            pjesSubtype: s.pjesSubtype,
            cotasPorServico: s.cotasPorServico,
            vagasNecessarias: s.vagasNecessarias,
            horarioInicio: s.horarioInicio,
            horarioTermino: s.horarioTermino,
            activeDates: s.activeDates,
            activationType: s.activationType
          })),
          existingEscalas: allEscalasOfMonth.map(e => ({
            policemenIds: e.policemenIds,
            serviceTypeId: e.serviceTypeId,
            date: format(e.date.toDate(), 'yyyy-MM-dd')
          })),
          ordinarySchedules: Object.fromEntries(
            Object.entries(ordinarySchedules).filter(([id]) => 
              joinedVolunteers.some(v => v.policemanId === id)
            )
          ),
          quotaSettings: unitQuotas,
          currentMonth: mKey,
          fairMode: fairMode
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Falha na resposta da IA');
      }
      
      const data = await response.json();

      if (data.assignments && data.assignments.length > 0) {
        let count = 0;
        const total = data.assignments.length;
        setAiProgress({ current: 0, total });

        const batchLog: { action: 'ASSIGN' | 'REMOVE', serviceId: string, policemanId: string, date: Date }[] = [];
        const localAssignments = [...joinedEscalas];

        for (let i = 0; i < data.assignments.length; i++) {
          const assignment = data.assignments[i];
          setAiProgress({ current: i + 1, total });

          try {
            const d = new Date(assignment.date + 'T12:00:00');
            const dateStr = format(d, 'yyyy-MM-dd');
            const service = services.find(s => s.id === assignment.serviceId);
            if (!service) continue;

            const dayNum = getDate(d);
            if ((ordinarySchedules[assignment.policemanId] || []).includes(dayNum)) continue;

            const hasConflict = localAssignments.some(e => {
              const eDateStr = format(e.date.toDate ? e.date.toDate() : e.date, 'yyyy-MM-dd');
              if (eDateStr !== dateStr) return false;
              if (!e.policemenIds.includes(assignment.policemanId)) return false;
              if (service.tipo === 'PJES' && e.service?.tipo === 'PJES') return true;
              return false;
            });
            if (hasConflict) continue;

            const existingInD = localAssignments.find(e => e.serviceTypeId === assignment.serviceId && format(e.date.toDate ? e.date.toDate() : e.date, 'yyyy-MM-dd') === dateStr);
            if (existingInD && existingInD.policemenIds.length >= (service.vagasNecessarias || 0)) continue;

            const success = await handleAssignService(assignment.serviceId, {
              policemanId: assignment.policemanId,
              date: d
            }, false, true); 
            
            if (success) {
              count++;
              batchLog.push({ action: 'ASSIGN', serviceId: assignment.serviceId, policemanId: assignment.policemanId, date: d });
              
              if (existingInD) {
                existingInD.policemenIds.push(assignment.policemanId);
              } else {
                localAssignments.push({
                  serviceTypeId: assignment.serviceId,
                  policemenIds: [assignment.policemanId],
                  date: d,
                  service: service
                } as any);
              }
            }
          } catch (itemErr) {
            console.error("Erro no item da IA:", itemErr);
          }
        }

        if (batchLog.length > 0) {
          setUndoStack(prev => [{ 
            action: 'BATCH_AI', 
            data: { batch: batchLog } 
          }, ...prev.slice(0, 19)]);
        }

        alert(`${count} escalas sugeridas pela IA foram processadas com sucesso.`);
      } else {
        alert("A IA não encontrou novas sugestões de escala que respeitem as regras atuais.");
      }
    } catch (err) {
      console.error(err);
      alert("Erro ao processar escala via IA: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setAiLoading(false);
      setAiProgress(null);
    }
  };

  const days = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth)
  });

  const handleMoveVolunteer = async (volunteerId: string, direction: 'up' | 'down') => {
    if (!isAdmin || submitting) return;

    const currentIndex = filteredVolunteers.findIndex(v => v.id === volunteerId);
    if (currentIndex === -1) return;

    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= filteredVolunteers.length) return;

    const currentV = filteredVolunteers[currentIndex];
    const targetV = filteredVolunteers[targetIndex];

    if (!currentV.id || !targetV.id) return;

    setSubmitting(true);
    try {
      // If order is not set, we assign current indices as initial order
      const currentOrder = currentV.order ?? currentIndex;
      const targetOrder = targetV.order ?? targetIndex;

      // Swap orders
      await Promise.all([
        updateDoc(doc(db, 'volunteers', currentV.id), { order: targetOrder }),
        updateDoc(doc(db, 'volunteers', targetV.id), { order: currentOrder })
      ]);
    } catch (err) {
      console.error("Erro ao mover voluntário:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSort = (field: typeof sortBy) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  const filteredVolunteers = useMemo(() => {
    const search = searchTerm.toLowerCase().trim();
    const result = joinedVolunteers
      .filter(v => v.type?.toUpperCase() === activeTab)
      .filter(v => {
        const poly = v.policeman;
        return !search || 
          poly?.nomeGuerra.toLowerCase().includes(search) || 
          poly?.matricula.includes(search);
      });

    // Apply Sorting
    return result.sort((a, b) => {
      const polyA = a.policeman;
      const polyB = b.policeman;
      
      if (!polyA || !polyB) return 0;

      let valA: any = polyA[sortBy];
      let valB: any = polyB[sortBy];

      // Special handling for Graduação/Posto to use military hierarchy if needed, 
      // but for now simple string sort or antiguidade is better.
      // If sorting by antiguidade, it's numeric.
      
      if (sortBy === 'antiguidade') {
        valA = polyA.antiguidade || 99999;
        valB = polyB.antiguidade || 99999;
      }

      if (sortBy === 'order') {
        valA = a.order ?? 99999;
        valB = b.order ?? 99999;
      }

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [joinedVolunteers, activeTab, searchTerm, sortBy, sortOrder]);

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
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
      
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
                onClick={handleUndo}
                disabled={undoStack.length === 0 || submitting || loading}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all border",
                  undoStack.length === 0 || submitting || loading
                    ? "bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed" 
                    : "bg-white text-pmpe-navy border-slate-200 hover:bg-slate-50 shadow-sm"
                )}
              >
                 <Undo2 className="w-3.5 h-3.5" />
                 Desfazer
              </button>

              <button 
                onClick={() => handleRemoteAISchedule(true)}
                disabled={aiLoading}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all border relative overflow-hidden",
                  aiLoading 
                    ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed" 
                    : "bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100"
                )}
              >
                 <BarChart3 className="w-3.5 h-3.5" />
                 Distribuir Justamente
              </button>

              <button 
                onClick={() => handleRemoteAISchedule(false)}
                disabled={aiLoading}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all border relative overflow-hidden",
                  aiLoading 
                    ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed" 
                    : "bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100"
                )}
              >
                 {aiLoading && aiProgress && (
                   <div 
                     className="absolute bottom-0 left-0 h-1 bg-emerald-400 transition-all duration-300" 
                     style={{ width: `${(aiProgress.current / aiProgress.total) * 100}%` }}
                   />
                 )}
                 <Sparkles className={cn("w-3.5 h-3.5", aiLoading && "animate-pulse")} />
                 {aiLoading ? (aiProgress ? `Processando ${aiProgress.current}/${aiProgress.total}` : 'IA Analisando...') : 'Escalar com IA'}
              </button>

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

      {/* Horizontal Services Dictionary */}
      <div className="bg-white border-b border-slate-200 px-8 py-3 shrink-0 shadow-sm z-20 overflow-hidden">
        <div className="flex items-center gap-6">
          <div className="shrink-0 flex items-center gap-4 pr-6 border-r border-slate-100">
             <div className="flex flex-col">
                <h3 className="text-[9px] font-black text-pmpe-navy uppercase tracking-[0.2em] flex items-center gap-2 mb-1">
                   <Shield className="w-3.5 h-3.5 text-pmpe-gold" />
                   Dicionário de Serviços ({activeTab})
                </h3>
                <div className="flex items-center gap-3">
                   {selectedServiceId && (
                      <button 
                        onClick={() => setSelectedServiceId(null)}
                        className="text-[7px] font-black text-rose-500 uppercase hover:bg-rose-50 px-2 py-0.5 rounded-md transition-colors border border-rose-100"
                      >
                         Limpar Pincel
                      </button>
                   )}
                   <p className="text-[7px] font-bold text-slate-400 uppercase italic">
                      {selectedServiceId ? "MODO PINCEL ATIVO" : "Selecione para pintar"}
                   </p>
                </div>
             </div>
          </div>

          <div className="relative w-44 shrink-0">
             <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
             <input 
                type="text"
                placeholder="Filtrar..."
                value={serviceSearchTerm}
                onChange={(e) => setServiceSearchTerm(e.target.value)}
                className="w-full pl-8 pr-4 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[8px] font-bold outline-none focus:ring-2 focus:ring-pmpe-navy/10 uppercase"
             />
          </div>

          <div className="flex-1 flex gap-3 overflow-x-auto pb-1 custom-matrix-scroll scrollbar-none">
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
                   className={cn(
                      "p-2 rounded-xl border transition-all group cursor-pointer select-none min-w-[140px] flex items-center gap-2",
                      selectedServiceId === s.id 
                        ? "bg-pmpe-navy border-pmpe-navy shadow-md ring-2 ring-pmpe-navy/10" 
                        : "border-slate-100 bg-white hover:border-slate-300 hover:shadow-sm"
                   )}
                >
                   <div 
                      draggable
                      onDragStart={(e) => {
                         e.dataTransfer.setData('serviceId', s.id!);
                         setSelectedServiceId(s.id!);
                      }}
                      onDragEnd={() => setSelectedServiceId(null)}
                      className={cn(
                         "w-8 h-8 rounded-lg flex items-center justify-center font-black text-[9px] shadow-sm shrink-0",
                         selectedServiceId === s.id ? "bg-white" : ""
                      )} 
                      style={selectedServiceId === s.id ? { color: s.color } : { backgroundColor: s.color, color: 'white' }}
                   >
                      {s.sigla}
                   </div>
                   <div className="flex-1 min-w-0">
                      <p className={cn(
                         "text-[9px] font-black uppercase leading-tight truncate",
                         selectedServiceId === s.id ? "text-white" : "text-pmpe-navy"
                      )}>{s.nome}</p>
                      <p className={cn(
                         "text-[7px] font-bold uppercase tracking-tighter mt-0.5",
                         selectedServiceId === s.id ? "text-white/60" : "text-slate-400"
                      )}>{s.horarioInicio} - {s.horarioTermino}</p>
                   </div>
                </div>
             ))}
             {services.filter(s => s.tipo?.toUpperCase() === activeTab && s.month === mKey).length === 0 && (
                <p className="text-[8px] font-black text-slate-300 uppercase py-2">Sem serviços cadastrados</p>
             )}
          </div>
        </div>
      </div>


      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden flex flex-col p-6 gap-6">
        
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
                    <th 
                      onClick={() => handleSort('graduacaoPosto')}
                      className="sticky left-0 z-30 p-3 min-w-[60px] bg-pmpe-navy text-center font-black uppercase text-[10px] border-b-2 border-black cursor-pointer hover:bg-slate-800 transition-colors"
                    >
                      <div className="flex items-center justify-center gap-1">
                        GRA.
                        {sortBy === 'graduacaoPosto' && (
                          sortOrder === 'asc' ? <ChevronLeft className="w-2.5 h-2.5 rotate-90 text-pmpe-gold" /> : <ChevronLeft className="w-2.5 h-2.5 -rotate-90 text-pmpe-gold" />
                        )}
                      </div>
                    </th>
                    <th 
                      onClick={() => handleSort('matricula')}
                      className="sticky left-[60px] z-30 p-3 min-w-[90px] bg-pmpe-navy text-center font-black uppercase text-[10px] border-b-2 border-black border-l-2 border-black cursor-pointer hover:bg-slate-800 transition-colors"
                    >
                      <div className="flex items-center justify-center gap-1">
                        MAT.
                        {sortBy === 'matricula' && (
                          sortOrder === 'asc' ? <ChevronLeft className="w-2.5 h-2.5 rotate-90 text-pmpe-gold" /> : <ChevronLeft className="w-2.5 h-2.5 -rotate-90 text-pmpe-gold" />
                        )}
                      </div>
                    </th>
                    <th 
                      onClick={() => handleSort('nomeGuerra')}
                      className="sticky left-[150px] z-30 p-4 min-w-[200px] bg-pmpe-navy text-left font-black uppercase text-[10px] border-b-2 border-black border-l-2 border-black uppercase tracking-wider cursor-pointer hover:bg-slate-800 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        EFETIVO
                        <div className="flex items-center gap-2">
                           <button 
                             onClick={(e) => { e.stopPropagation(); handleSort('antiguidade'); }}
                             className={cn(
                               "px-2 py-0.5 rounded text-[8px] border transition-all",
                               sortBy === 'antiguidade' ? "bg-pmpe-gold text-pmpe-navy border-pmpe-gold" : "bg-white/10 border-white/20 text-white/60"
                             )}
                           >
                             SORT: ANTIGUIDADE
                           </button>
                           <button 
                             onClick={(e) => { e.stopPropagation(); handleSort('order'); }}
                             className={cn(
                               "px-2 py-0.5 rounded text-[8px] border transition-all",
                               sortBy === 'order' ? "bg-pmpe-gold text-pmpe-navy border-pmpe-gold" : "bg-white/10 border-white/20 text-white/60"
                             )}
                           >
                             PERSONALIZADO
                           </button>
                           {sortBy === 'nomeGuerra' && (
                             sortOrder === 'asc' ? <ChevronLeft className="w-2.5 h-2.5 rotate-90 text-pmpe-gold" /> : <ChevronLeft className="w-2.5 h-2.5 -rotate-90 text-pmpe-gold" />
                           )}
                        </div>
                      </div>
                    </th>
                    
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
                  ) : (
                    <SortableContext
                      items={filteredVolunteers.map(v => v.id!)}
                      strategy={verticalListSortingStrategy}
                    >
                      {filteredVolunteers.map(v => (
                        <SortableRow 
                          key={v.id}
                          v={v}
                          policemanId={v.policemanId}
                          policeman={v.policeman}
                          cotas={v.cotas}
                          joinedEscalas={joinedEscalas}
                          activeTab={activeTab}
                          days={days}
                          ordinarySchedules={ordinarySchedules}
                          services={services}
                          selectedServiceId={selectedServiceId}
                          assignmentModal={assignmentModal}
                          submitting={submitting}
                          searchTerm={searchTerm}
                          isAdmin={isAdmin}
                          handleAssignService={handleAssignService}
                          handleRemoveFromScale={handleRemoveFromScale}
                          setAssignmentModal={setAssignmentModal}
                          sortBy={sortBy}
                        />
                      ))}
                    </SortableContext>
                  )}
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
                  <div className="w-4 h-4 bg-pmpe-red rounded shadow-sm flex items-center justify-center text-[7px] text-white/40 font-black"><CheckCircle2 className="w-2 h-2" /></div>
                  <span className="text-[9px] font-black text-slate-500 uppercase">Serviço Ordinário</span>
               </div>
               <div className="ml-auto flex items-center gap-2">
                  <span className="text-[9px] font-black text-pmpe-navy uppercase opacity-40 italic tracking-widest">Utilize as SIGLAS dos serviços para identificação.</span>
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
      </DndContext>
    </div>
  );
};

// --- Sortable Component for matrix rows ---
const SortableRow = ({ 
  v, 
  policemanId, 
  policeman, 
  cotas, 
  joinedEscalas, 
  activeTab, 
  days, 
  ordinarySchedules, 
  services,
  selectedServiceId,
  assignmentModal,
  submitting,
  searchTerm,
  isAdmin,
  handleAssignService,
  handleRemoveFromScale,
  setAssignmentModal,
  sortBy
}: any) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: v.id! });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 40 : 1,
    position: 'relative' as const,
  };

  const scaledPMRecords = joinedEscalas.filter((e: any) => e.policemenIds.includes(policemanId));
  const currentTabScales = scaledPMRecords.filter((e: any) => e.service?.tipo?.toUpperCase() === activeTab);
  const scaledCount = currentTabScales.reduce((acc: number, e: any) => acc + Number(e.service?.cotasPorServico || 1), 0);
  const solicted = Number(cotas || 0);
  const remaining = solicted - scaledCount;

  return (
    <tr 
      ref={setNodeRef} 
      style={style}
      className={cn(
        "h-12 hover:bg-slate-50 transition-colors group",
        isDragging && "bg-slate-50 shadow-lg"
      )}
    >
      {/* Fixed ID Info */}
      <td className="sticky left-0 z-10 p-3 bg-white group-hover:bg-slate-50 text-center font-black text-slate-500 border-r-2 border-b-2 border-black">
        <div className="flex items-center gap-1">
           {sortBy === 'order' && !searchTerm && isAdmin && (
             <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-1 text-slate-300 hover:text-slate-500">
               <GripVertical className="w-3.5 h-3.5" />
             </div>
           )}
           <span className="flex-1">{policeman?.graduacaoPosto.substring(0, 3)}</span>
        </div>
      </td>
      <td className="sticky left-[60px] z-10 p-3 bg-white group-hover:bg-slate-50 text-center font-bold text-slate-500 border-r-2 border-b-2 border-black">{policeman?.matricula}</td>
      <td className="sticky left-[150px] z-10 p-3 bg-white group-hover:bg-slate-50 font-black text-pmpe-navy uppercase pl-5 border-r-2 border-b-2 border-black truncate">
         <span className="truncate">{policeman?.nomeGuerra}</span>
      </td>

      {/* Stats Dynamic Columns */}
      <td className="bg-amber-50/20 text-center font-black text-amber-600 border-r-2 border-b-2 border-black text-[12px]">{solicted}</td>
      <td className="bg-slate-50/50 text-center font-bold text-slate-300 italic border-r-2 border-b-2 border-black text-[12px]">{days.length - (ordinarySchedules[policemanId]?.length || 0)}</td>
      <td className="bg-emerald-50/50 text-center font-black text-emerald-600 border-r-2 border-b-2 border-black text-[12px]">{scaledCount}</td>
      <td className={cn(
        "text-center font-black border-r-2 border-b-2 border-black text-[12px]",
        remaining > 0 ? "bg-rose-50/50 text-rose-600" : "bg-emerald-50 text-emerald-500"
      )}>{remaining}</td>

      {/* Matrix cells for each day */}
      {days.map((date: Date) => {
        const dayNum = getDate(date);
        const isOrd = (ordinarySchedules[policemanId] || []).includes(dayNum);
        const scales = scaledPMRecords.filter((e: any) => isSameDay(e.date.toDate(), date));
        const currentSelectedService = selectedServiceId ? services.find((s: any) => s.id === selectedServiceId) : null;
        const dateStr = format(date, 'yyyy-MM-dd');

        // Vacancy check for the selected service on this specific date
        const escalaToday = joinedEscalas.find((e: any) => e.serviceTypeId === selectedServiceId && format(e.date.toDate(), 'yyyy-MM-dd') === dateStr);
        const slotsUsed = escalaToday?.policemenIds.length || 0;
        const slotsMax = currentSelectedService?.vagasNecessarias || 0;
        const isFull = slotsMax > 0 && slotsUsed >= slotsMax;

        const isServiceActiveOnThisDay = currentSelectedService ? (
           currentSelectedService.activationType === 'ALL' || 
           (currentSelectedService.activeDates || []).includes(dateStr)
        ) : false;
        
        // Check if person already has a scale of the SAME type as currently selected
        const hasSameTypeScale = currentSelectedService && scales.some((s: any) => s.service?.tipo === currentSelectedService.tipo);

        const isCurrentlyTarget = assignmentModal?.policemanId === policemanId && isSameDay(assignmentModal.date, date);
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
                const ds = services.find((s: any) => s.id === draggedServiceId);
                
                // Specific type check for drop
                const alreadyHasType = ds && scales.some((s: any) => s.service?.tipo === ds.tipo);
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
                const scaleToday = joinedEscalas.find((e: any) => e.serviceTypeId === draggedServiceId && format(e.date.toDate(), 'yyyy-MM-dd') === dStr);
                const used = scaleToday?.policemenIds.length || 0;
                const max = ds.vagasNecessarias || 0;
                if (max > 0 && used >= max) {
                  alert(`Este serviço (${ds.sigla}) já atingiu o limite de vagas para este dia.`);
                  return;
                }

                handleAssignService(draggedServiceId, { 
                  policemanId: policemanId, 
                  date 
                });
              }
            }}
            onClick={() => {
              if (submitting) return;
              if (isOrd) {
                alert('Este policial está em SERVIÇO ORDINÁRIO nesta data. Escala extra não permitida.');
                return;
              }
              if (selectedServiceId) {
                if (!isServiceActiveOnThisDay) {
                  alert('Este serviço não está configurado para estar ativo nesta data.');
                  return;
                }
                if (hasSameTypeScale && currentSelectedService?.tipo === 'PJES') {
                  alert('Este policial já possui uma escala de PJES para este dia.');
                  return;
                }
                if (isFull) {
                  alert(`Este serviço (${currentSelectedService?.sigla}) já atingiu o limite de vagas para este dia.`);
                  return;
                }
                
                handleAssignService(selectedServiceId, { 
                  policemanId: policemanId, 
                  date 
                });
              } else {
                setAssignmentModal({
                   policemanId: policemanId,
                   policemanName: policeman?.nomeGuerra || '',
                   policemanMat: policeman?.matricula || '',
                   date: date
                });
              }
            }}
            className={cn(
              "relative p-0 border-r-2 border-b-2 border-black transition-all text-center h-14 w-14",
              !isOrd ? "cursor-pointer" : "bg-pmpe-red shadow-inner",
              isWeekend(date) && !isOrd && "bg-slate-50/50",
              scales.length === 0 && !isOrd ? "bg-slate-50 hover:bg-slate-200" : "",
              selectedServiceId && isServiceActiveOnThisDay && !isOrd && !hasSameTypeScale ? (
                isFull 
                  ? "bg-rose-50/70 ring-inset ring-2 ring-rose-500/30 cursor-not-allowed opacity-60" 
                  : "bg-emerald-50/50 ring-inset ring-2 ring-emerald-500/30 group-hover:bg-emerald-100"
              ) : "",
              isCurrentlyTarget && "z-50 ring-4 ring-pmpe-gold/50 shadow-2xl scale-105"
            )}
          >
             {scales.length > 0 ? (
                  <div className="flex flex-col gap-0.5 p-1 h-full overflow-hidden">
                    {scales.map((e: any) => (
                      <div 
                        key={e.id}
                        className="text-[7px] font-black text-white px-1.5 py-0.5 rounded-sm shadow-sm truncate flex items-center justify-between"
                        style={{ backgroundColor: e.service?.color || '#000' }}
                      >
                        <span>{e.service?.sigla}</span>
                        {isAdmin && (
                          <button 
                            onClick={(e2) => {
                              e2.stopPropagation();
                              handleRemoveFromScale(e.id!, policemanId);
                            }}
                            className="ml-1 opacity-0 group-hover:opacity-100 hover:text-rose-200"
                          >
                            <X className="w-2 h-2" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : isOrd ? (
                  <div className="bg-pmpe-red w-full h-full flex flex-col items-center justify-center text-white">
                    <CheckCircle2 className="w-3.5 h-3.5 mb-0.5" />
                    <span className="text-[7px] font-black tracking-tighter opacity-80">ORDINÁRIO</span>
                  </div>
                ) : isFull && selectedServiceId ? (
                  <div className="w-full h-full flex flex-col items-center justify-center bg-rose-50/50">
                    <span className="text-[8px] text-rose-500 font-black leading-none mb-0.5">LOTADO</span>
                  </div>
                ) : isSubmittingThisCell ? (
                  <div className="w-full h-full flex items-center justify-center">
                    <div className="w-4 h-4 border-2 border-pmpe-navy/20 border-t-pmpe-navy rounded-full animate-spin" />
                  </div>
                ) : null}
          </td>
        );
      })}
    </tr>
  );
};

export default CreateEscala;
