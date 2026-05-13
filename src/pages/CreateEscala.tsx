import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
  updateDoc,
  arrayUnion,
  arrayRemove
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { Policeman, ServiceType, Volunteer, Escala, QuotaSettings, QuotaLog, OrdinarySchedule } from '../types';
import { OperationType, handleFirestoreError, cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
// ... (mantenha seus imports de ícones e date-fns)

const CreateEscala = () => {
  const { isAdmin } = useAuth();
  const [services, setServices] = useState<ServiceType[]>([]);
  const [volunteers, setVolunteers] = useState<(Volunteer & { policeman?: Policeman })[]>([]);
  const [allEscalasOfMonth, setAllEscalasOfMonth] = useState<(Escala & { service?: ServiceType })[]>([]);
  const [policemen, setPolicemen] = useState<Record<string, Policeman>>({});
  const [ordinarySchedules, setOrdinarySchedules] = useState<Record<string, number[]>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [activeTab, setActiveTab] = useState<'PJES' | 'OPS'>('PJES');
  const [searchTerm, setSearchTerm] = useState('');

  const mKey = format(currentMonth, 'yyyy-MM');

  // 1. Carregamento de dados estáticos (Otimizado)
  useEffect(() => {
    const loadStaticData = async () => {
      try {
        const [sSnap, polySnap, ordSnap] = await Promise.all([
          getDocs(query(collection(db, 'serviceTypes'))),
          getDocs(collection(db, 'policemen')),
          getDocs(query(collection(db, 'ordinarySchedules'), where('month', '==', mKey)))
        ]);

        const sData = sSnap.docs.map(d => ({
          id: d.id,
          ...d.data(),
          cotasPorServico: d.data().cotasPorServico ?? 1
        } as ServiceType));
        setServices(sData);

        const polyData = polySnap.docs.reduce((acc, d) => {
          acc[d.id] = { id: d.id, ...d.data() } as Policeman;
          return acc;
        }, {} as Record<string, Policeman>);
        setPolicemen(polyData);

        const oMap: Record<string, number[]> = {};
        ordSnap.docs.forEach(d => {
          const data = d.data() as OrdinarySchedule;
          oMap[data.policemanId] = data.days || [];
        });
        setOrdinarySchedules(oMap);
      } catch (err) {
        handleFirestoreError(err, OperationType.READ, 'staticData');
      }
    };

    loadStaticData();
  }, [mKey]);

  // 2. Listeners em Tempo Real (Com limpeza de memória garantida)
  useEffect(() => {
    const start = Timestamp.fromDate(startOfMonth(currentMonth));
    const end = Timestamp.fromDate(endOfMonth(currentMonth));

    const unsubEscalas = onSnapshot(
      query(collection(db, 'escalas'), where('date', '>=', start), where('date', '<=', end)),
      (snap) => {
        setAllEscalasOfMonth(snap.docs.map(d => ({
          id: d.id,
          ...d.data(),
          service: services.find(s => s.id === d.data().serviceTypeId)
        } as any)));
        setLoading(false);
      }
    );

    // Adicione aqui os outros unsubscribes (volunteers, quotaLogs, quotaSettings)
    // seguindo o mesmo padrão de conferência do mKey.

    return () => unsubEscalas();
  }, [currentMonth, services]);

  // 3. Função de Escala (Corrigida para evitar Race Conditions)
  const handleAssignService = async (serviceId: string, policemanId: string, date: Date) => {
    if (submitting || !isAdmin) return;

    const service = services.find(s => s.id === serviceId);
    if (!service) return;

    const dateStr = format(date, 'yyyy-MM-dd');
    const needed = service.cotasPorServico || 1;

    // Check de duplicidade local para UX rápida
    const isAlreadyScaled = allEscalasOfMonth.some(e => 
      format(e.date.toDate(), 'yyyy-MM-dd') === dateStr && 
      e.policemenIds.includes(policemanId) &&
      e.service?.tipo === service.tipo
    );

    if (isAlreadyScaled) {
      alert("Policial já possui escala deste tipo para este dia.");
      return;
    }

    setSubmitting(true);
    try {
      const existingEscala = allEscalasOfMonth.find(e => 
        e.serviceTypeId === serviceId && format(e.date.toDate(), 'yyyy-MM-dd') === dateStr
      );

      let escalaId = existingEscala?.id;

      if (existingEscala) {
        // Uso de arrayUnion: Operação segura no servidor
        await updateDoc(doc(db, 'escalas', existingEscala.id), {
          policemenIds: arrayUnion(policemanId),
          updatedAt: serverTimestamp()
        });
      } else {
        const newDoc = await addDoc(collection(db, 'escalas'), {
          serviceTypeId: serviceId,
          policemenIds: [policemanId],
          date: Timestamp.fromDate(date),
          createdAt: serverTimestamp()
        });
        escalaId = newDoc.id;
      }

      // Log de Cota
      await addDoc(collection(db, 'quotaLogs'), {
        serviceTypeId: serviceId,
        escalaId,
        policemanId,
        quantidade: needed,
        tipo: service.tipo,
        pjesSubtype: service.pjesSubtype,
        data: serverTimestamp(),
        month: mKey,
        createdBy: auth.currentUser?.email
      });

    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'escalas');
    } finally {
      setSubmitting(false);
    }
  };

  // 4. Remoção de Escala (Segura)
  const handleRemoveFromScale = async (escalaId: string, policemanId: string) => {
    if (!isAdmin) return;
    
    try {
      const escala = allEscalasOfMonth.find(e => e.id === escalaId);
      if (!escala) return;

      if (escala.policemenIds.length <= 1) {
        await deleteDoc(doc(db, 'escalas', escalaId));
      } else {
        await updateDoc(doc(db, 'escalas', escalaId), {
          policemenIds: arrayRemove(policemanId)
        });
      }

      // Limpar logs associados (Opcional: usar Cloud Function para isso em produção)
      const logs = await getDocs(query(
        collection(db, 'quotaLogs'), 
        where('escalaId', '==', escalaId), 
        where('policemanId', '==', policemanId)
      ));
      logs.forEach(l => deleteDoc(l.ref));

    } catch (err) {
      console.error("Erro ao remover:", err);
    }
  };

  // ... (Restante da renderização permanece igual)