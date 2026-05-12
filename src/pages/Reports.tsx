import React, { useState, useEffect, useRef } from 'react';
import { 
  collection, 
  getDocs, 
  query, 
  where, 
  orderBy,
  Timestamp
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Escala, Policeman, ServiceType } from '../types';
import { 
  FileText, 
  Download, 
  Printer, 
  ChevronLeft, 
  ChevronRight,
  Filter,
  FileSpreadsheet
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, getDate, eachDayOfInterval } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { handleFirestoreError, OperationType, cn } from '../lib/utils';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';

const Reports = () => {
  const [loading, setLoading] = useState(false);
  const [services, setServices] = useState<ServiceType[]>([]);
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [reportMode, setReportMode] = useState<'SEI' | 'MATRIX'>('SEI');
  const [escalas, setEscalas] = useState<(Escala & { policemenObjects: Policeman[] })[]>([]);
  const [policemen, setPolicemen] = useState<Policeman[]>([]);
  
  const reportRef = useRef<HTMLDivElement>(null);
  const matrixRef = useRef<HTMLDivElement>(null);
  
  const monthName = format(currentDate, 'MMMM yyyy', { locale: ptBR });
  const monthKey = format(currentDate, 'yyyy-MM');
  const daysInMonth = eachDayOfInterval({
    start: startOfMonth(currentDate),
    end: endOfMonth(currentDate)
  });

  useEffect(() => {
    const fetchServices = async () => {
      try {
        const snap = await getDocs(query(collection(db, 'serviceTypes'), orderBy('nome')));
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as ServiceType));
        setServices(data);
        if (data.length > 0) setSelectedServiceId(data[0].id!);
      } catch (err) {
        console.error(err);
      }
    };
    fetchServices();
  }, []);

  useEffect(() => {
    fetchReportData();
  }, [selectedServiceId, currentDate, reportMode]);

  const fetchReportData = async () => {
    setLoading(true);
    try {
      const monthStart = Timestamp.fromDate(startOfMonth(currentDate));
      const monthEnd = Timestamp.fromDate(endOfMonth(currentDate));
      
      let eQ;
      if (reportMode === 'SEI' && selectedServiceId) {
        eQ = query(
          collection(db, 'escalas'),
          where('serviceTypeId', '==', selectedServiceId),
          where('date', '>=', monthStart),
          where('date', '<=', monthEnd),
          orderBy('date', 'asc')
        );
      } else {
        // For MATRIX mode, fetch ALL scales of the month
        eQ = query(
          collection(db, 'escalas'),
          where('date', '>=', monthStart),
          where('date', '<=', monthEnd),
          orderBy('date', 'asc')
        );
      }
      
      const eSnap = await getDocs(eQ);
      const eData = eSnap.docs.map(d => ({ ...d.data() as any, id: d.id } as Escala));
      
      const pSnap = await getDocs(collection(db, 'policemen'));
      const pData = pSnap.docs.map(d => ({ id: d.id, ...d.data() } as Policeman));
      pData.sort((a,b) => a.antiguidade - b.antiguidade);
      setPolicemen(pData);

      const combined = eData.map(esc => ({
        ...esc,
        policemenObjects: esc.policemenIds.map(id => pData.find(p => p.id === id)).filter(Boolean) as Policeman[]
      }));
      
      setEscalas(combined);
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, 'reports');
    } finally {
      setLoading(false);
    }
  };

  const exportToPDF = async () => {
    const targetRef = reportMode === 'SEI' ? reportRef : matrixRef;
    if (!targetRef.current) return;
    
    setLoading(true);
    try {
      const canvas = await html2canvas(targetRef.current, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff'
      });
      
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF(reportMode === 'MATRIX' ? 'l' : 'p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      
      pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);
      pdf.save(`Relatorio_${reportMode}_${monthKey}.pdf`);
    } catch (err) {
      console.error(err);
      alert('Erro ao gerar PDF');
    } finally {
      setLoading(false);
    }
  };

  const exportToExcel = () => {
    if (reportMode === 'SEI') {
      const selectedService = services.find(s => s.id === selectedServiceId);
      const rows = escalas.flatMap(esc => 
        esc.policemenObjects.map(p => ({
          GRADUAÇÃO: p.graduacaoPosto,
          MATRÍCULA: p.matricula,
          'NOME DE GUERRA': p.nomeGuerra,
          OME: '9ª CIPM',
          FUNÇÃO: p.id === esc.policemenIds[0] ? 'COMANDANTE' : (p.isMotorista ? 'MOTORISTA' : 'PATRULHEIRO'),
          DIA: getDate(esc.date.toDate()),
          COTAS: 1,
          JORNADA: selectedService ? `${selectedService.horarioInicio} às ${selectedService.horarioTermino}` : '07h às 19h'
        }))
      );

      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Escala");
      XLSX.writeFile(workbook, `Escala_${monthKey}.xlsx`);
    } else {
      // MATRIX Excel
      const rows = policemen
        .filter(p => escalas.some(esc => esc.policemenIds.includes(p.id!)))
        .map(p => {
          const row: any = { 'NOME DE GUERRA': p.nomeGuerra };
          daysInMonth.forEach(day => {
            const d = getDate(day);
            const foundEsc = escalas.find(esc => getDate(esc.date.toDate()) === d && esc.policemenIds.includes(p.id!));
            const sType = services.find(s => s.id === foundEsc?.serviceTypeId);
            row[d] = sType ? sType.nome : '';
          });
          return row;
        });
      
      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Mapa Mensal");
      XLSX.writeFile(workbook, `Mapa_Mensal_${monthKey}.xlsx`);
    }
  };

  const selectedService = services.find(s => s.id === selectedServiceId);

  return (
    <div className="space-y-6">
      {/* Mode Toggle & Filters */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex bg-slate-100 p-1 rounded-xl w-fit">
            <button
              onClick={() => setReportMode('SEI')}
              className={cn(
                "px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                reportMode === 'SEI' ? "bg-white text-pmpe-navy shadow-sm" : "text-slate-500 hover:text-slate-800"
              )}
            >
              Modelo Padrão SEI
            </button>
            <button
              onClick={() => setReportMode('MATRIX')}
              className={cn(
                "px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                reportMode === 'MATRIX' ? "bg-white text-pmpe-navy shadow-sm" : "text-slate-500 hover:text-slate-800"
              )}
            >
              Quadro de Escala Mensal
            </button>
          </div>

          <div className="flex gap-2">
            <button
              onClick={exportToExcel}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700 flex items-center gap-2 shadow-sm"
            >
              <FileSpreadsheet className="w-4 h-4" /> Excel
            </button>
            <button
              onClick={exportToPDF}
              className="px-4 py-2 bg-pmpe-red text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-red-700 flex items-center gap-2 shadow-sm"
            >
              <Download className="w-4 h-4" /> PDF
            </button>
            <button
              onClick={() => window.print()}
              className="px-4 py-2 bg-slate-800 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-slate-900 flex items-center gap-2 shadow-sm"
            >
              <Printer className="w-4 h-4" /> Imprimir
            </button>
          </div>
        </div>

        <div className="flex flex-col md:flex-row md:items-center gap-4 border-t border-slate-100 pt-4">
          {reportMode === 'SEI' && (
            <div className="min-w-[200px]">
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
                <Filter className="w-3 h-3" /> Tipo de Serviço
              </label>
              <select
                value={selectedServiceId}
                onChange={(e) => setSelectedServiceId(e.target.value)}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pmpe-navy/5"
              >
                {services.map(s => (
                  <option key={s.id} value={s.id}>{s.tipo} - {s.nome}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
               Mês de Referência
            </label>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
                className="p-2 hover:bg-slate-100 rounded-lg"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="px-4 py-2 bg-slate-50 rounded-lg border border-slate-200 text-sm font-bold text-center capitalize min-w-[140px]">
                {monthName}
              </div>
              <button 
                onClick={() => setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
                className="p-2 hover:bg-slate-100 rounded-lg"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-4 border-pmpe-navy border-t-transparent"></div>
        </div>
      ) : reportMode === 'SEI' ? (
        <div className="overflow-x-auto p-4 bg-slate-100 rounded-xl">
          <div 
            ref={reportRef}
            id="sei-report"
            className="bg-white mx-auto shadow-2xl p-[15mm] text-black font-serif"
            style={{ width: '210mm', minHeight: '297mm' }}
          >
            {/* Header Logos */}
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
              <p className="text-[10px] font-bold uppercase mb-4">ESCALA DE SERVIÇO nº {Math.floor(Math.random() * 100) + 1} – PMPE - 9CIPM-P1-{selectedService?.tipo}</p>
              
              <h2 className="text-sm font-black uppercase mb-1">ESCALA {selectedService?.nome} - {monthName}</h2>
            </div>

            {/* Main Table */}
            <table className="w-full border-collapse border border-slate-300 text-[9px]">
              <thead>
                <tr className="bg-[#f0ad4e] text-black font-black uppercase h-8">
                  <th colSpan={8} className="border border-slate-300 text-center text-[10px]">
                    {selectedService?.nome} - {monthName}
                  </th>
                </tr>
                <tr className="bg-white text-black font-black uppercase text-[8px]">
                  <th colSpan={8} className="border border-slate-300 px-2 py-1 text-left">
                    LOCAL: {selectedService?.cidade} / ÁREA DA 9ª CIPM
                  </th>
                </tr>
                <tr className="bg-slate-50 font-bold uppercase text-[7px]">
                  <th className="border border-slate-300 p-1 w-[12%]">Graduação</th>
                  <th className="border border-slate-300 p-1 w-[12%]">Matrícula</th>
                  <th className="border border-slate-300 p-1">Nome de Guerra</th>
                  <th className="border border-slate-300 p-1 w-[10%]">OME</th>
                  <th className="border border-slate-300 p-1 w-[15%]">Função</th>
                  <th className="border border-slate-300 p-1 w-[6%]">Dias</th>
                  <th className="border border-slate-300 p-1 w-[6%]">Cotas</th>
                  <th className="border border-slate-300 p-1 w-[15%]">Jornada</th>
                </tr>
              </thead>
              <tbody>
                {escalas.map((esc) => (
                  <React.Fragment key={esc.id}>
                    {esc.policemenObjects.map((p, pIdx) => (
                      <tr key={`${esc.id}-${p.id}`} className="hover:bg-slate-50 transition-colors">
                        <td className="border border-slate-300 p-1 text-center font-bold">{p.graduacaoPosto}</td>
                        <td className="border border-slate-300 p-1 text-center font-bold">{p.matricula}</td>
                        <td className="border border-slate-300 p-1 px-2 font-bold">{p.nomeGuerra}</td>
                        <td className="border border-slate-300 p-1 text-center">9ª CIPM</td>
                        <td className="border border-slate-300 p-1 text-center uppercase">
                          {pIdx === 0 ? 'Comandante' : (p.isMotorista ? 'Motorista' : 'Patrulheiro')}
                        </td>
                        <td className="border border-slate-300 p-1 text-center font-bold">
                          {getDate(esc.date.toDate())}
                        </td>
                        <td className="border border-slate-300 p-1 text-center">1</td>
                        <td className="border border-slate-300 p-1 text-center">
                          {selectedService ? `${selectedService.horarioInicio} às ${selectedService.horarioTermino}` : '07:00 às 19:00'}
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
                
                {/* Total Row */}
                <tr className="bg-[#f0ad4e] font-black h-8">
                  <td colSpan={6} className="border border-slate-300 border-r-0 px-4 text-right uppercase">Total</td>
                  <td colSpan={2} className="border border-slate-300 border-l-0 px-4 text-left">
                    {escalas.reduce((acc, curr) => acc + curr.policemenIds.length, 0)}
                  </td>
                </tr>
              </tbody>
            </table>

            {/* Signature Section */}
            <div className="mt-12 text-[10px]">
              <p className="mb-12">Araripina-PE, {format(new Date(), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}.</p>
              
              <div className="flex flex-col items-center ml-auto w-1/2 mt-10">
                <div className="w-48 border-t border-black mb-1"></div>
                <p className="font-bold text-center">PAULO HENRIQUE DA SILVA TAVARES - 2º TEN QOPM</p>
                <p className="uppercase text-center">Coordenador do PJES</p>
              </div>
            </div>

            {/* SEI Footer */}
            <div className="mt-auto pt-20">
              <div className="border border-slate-300 p-3 rounded flex gap-4 items-start">
                 <div className="w-16 h-16 bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                    <p className="text-[8px] font-bold text-center leading-tight">Assinatura<br/>Eletrônica</p>
                 </div>
                 <div className="text-[7.5px] text-slate-500 leading-tight">
                    <p className="font-bold text-black mb-1">Documento assinado eletronicamente por PAULO HENRIQUE DA SILVA TAVARES, em {format(new Date(), 'dd/MM/yyyy')}, às {format(new Date(), 'HH:mm')}, conforme horário oficial de Recife, com fundamento no art. 10º, do Decreto nº 45.157, de 23 de outubro de 2017.</p>
                    <p className="mt-1">A autenticidade deste documento pode ser conferida no site http://sei.pe.gov.br/sei/controlador_externo.php informando o código verificador.</p>
                 </div>
              </div>
              <p className="text-[8px] text-center mt-6 text-slate-400 italic">"Nossa Presença, sua Segurança"</p>
            </div>
          </div>
        </div>
      ) : (
        /* MATRIX VIEW - Sophisticated Monthly Board */
        <div className="overflow-x-auto p-4 bg-slate-100 rounded-xl">
          <div 
            ref={matrixRef}
            id="matrix-report"
            className="bg-white mx-auto shadow-2xl p-8 text-black min-w-max"
            style={{ minHeight: '210mm' }}
          >
            <div className="text-center mb-8 border-b-2 border-pmpe-navy pb-6">
              <h2 className="text-2xl font-black text-pmpe-navy uppercase tracking-tight">Quadro de Distribuição de Efetivo Operacional</h2>
              <p className="text-sm font-bold text-slate-500 uppercase tracking-[0.3em]">{monthName}</p>
            </div>

            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="border-2 border-slate-800 p-2 bg-slate-800 text-white text-[10px] uppercase font-black sticky left-0 z-20 min-w-[200px]">
                    Policial / Dia
                  </th>
                  {daysInMonth.map(day => (
                    <th key={day.toISOString()} className="border-2 border-slate-300 p-1 w-8 text-[9px] font-black uppercase bg-slate-50">
                      {getDate(day)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {policemen
                  .filter(p => escalas.some(esc => esc.policemenIds.includes(p.id!)))
                  .map(p => (
                    <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                      <td className="border-2 border-slate-300 p-2 text-[10px] font-bold bg-white sticky left-0 z-10 shadow-[2px_0_4px_rgba(0,0,0,0.05)]">
                        {p.graduacaoPosto} {p.nomeGuerra}
                      </td>
                      {daysInMonth.map(day => {
                        const d = getDate(day);
                        const foundEsc = escalas.find(esc => getDate(esc.date.toDate()) === d && esc.policemenIds.includes(p.id!));
                        const sType = services.find(s => s.id === foundEsc?.serviceTypeId);
                        
                        return (
                          <td 
                            key={day.toISOString()} 
                            className={cn(
                              "border-2 border-slate-300 p-0 text-[8px] font-black text-center relative h-10 w-8",
                              sType ? "bg-pmpe-navy/10" : ""
                            )}
                          >
                            {sType && (
                              <div 
                                title={`${sType.tipo} - ${sType.nome}`}
                                className={cn(
                                  "absolute inset-0 flex items-center justify-center",
                                  sType.tipo === 'PJES' ? "text-emerald-700" : "text-blue-700"
                                )}
                              >
                                {sType.tipo === 'PJES' ? 'P' : 'O'}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </tbody>
            </table>

            <div className="mt-8 grid grid-cols-2 gap-8 pt-8 border-t border-slate-200">
               <div className="space-y-2">
                 <h4 className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Legenda de Cobertura</h4>
                 <div className="flex gap-4">
                   <div className="flex items-center gap-2">
                     <span className="w-3 h-3 bg-emerald-100 border border-emerald-300 flex items-center justify-center text-[8px] font-black text-emerald-700">P</span>
                     <span className="text-[9px] font-bold uppercase">Escala PJES</span>
                   </div>
                   <div className="flex items-center gap-2">
                     <span className="w-3 h-3 bg-blue-100 border border-blue-300 flex items-center justify-center text-[8px] font-black text-blue-700">O</span>
                     <span className="text-[9px] font-bold uppercase">Escala OPS</span>
                   </div>
                 </div>
               </div>
               <div className="text-right">
                 <p className="text-[10px] font-black uppercase tracking-tighter text-slate-800">Visualização de Intensidade Operacional</p>
                 <p className="text-[8px] font-bold text-slate-400">Gerado automaticamente pelo sistema de GESTÃO DE ESCALAS - 9ª CIPM</p>
               </div>
            </div>
          </div>
        </div>
      )}

      {/* Print styles */}
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #sei-report, #sei-report *, #matrix-report, #matrix-report * {
            visibility: visible;
          }
          #sei-report, #matrix-report {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            margin: 0;
            padding: 0;
          }
        }
      `}</style>
    </div>
  );
};

export default Reports;
