/**
 * Datos de ejemplo: 14 notas enlazadas entre si, para ver el grafo con contenido real.
 * Es idempotente: si una nota con ese titulo ya existe, la saltea.
 */
import type { SaveNoteInput } from '@bitacora/shared';
import { createApp } from './bootstrap.js';
import { getNoteByTitle } from './services/notes.js';

interface SeedNote extends Omit<SaveNoteInput, 'summary' | 'pendientes' | 'referencias' | 'relacionados'> {
  summary: string;
  date: string;
  time: string;
  pendientes: SaveNoteInput['pendientes'];
  referencias: string[];
  relacionados: string[];
}

const NOTES: SeedNote[] = [
  {
    title: 'Investigacion OOS valoracion lote AMX-2401',
    folder: 'Calidad',
    date: '2026-03-04',
    time: '10:15',
    tags: ['calidad', 'oos', 'hplc'],
    summary: 'Resultado fuera de especificacion en valoracion atribuido a la calibracion del HPLC.',
    contexto:
      'El lote AMX-2401 de amoxicilina 500 mg capsulas dio un resultado fuera de especificacion en valoracion durante el ensayo de liberacion. Se abrio la investigacion segun el procedimiento interno de manejo de OOS y se reviso el desempeno del equipo analitico.',
    decisiones: [
      'Se identifico la calibracion vencida del HPLC del laboratorio de control como causa raiz probable.',
      'Se decidio re-analizar el lote con el equipo de respaldo, previa verificacion de su calibracion.',
      'El re-analisis se documenta como ensayo de confirmacion, no como liberacion.'
    ],
    pendientes: [
      { accion: 'Re-analizar las muestras del lote AMX-2401 con el HPLC de respaldo', responsable: 'Control de Calidad', fecha: '10/03/2026', hecho: true },
      { accion: 'Redactar la CAPA formal de la investigacion', responsable: 'Calidad', fecha: '20/03/2026' }
    ],
    referencias: ['Procedimiento interno de manejo de resultados OOS'],
    relacionados: ['Calificacion del HPLC del laboratorio de control', 'CAPA-2026-014 frecuencia de calibracion']
  },
  {
    title: 'Calificacion del HPLC del laboratorio de control',
    folder: 'Calidad',
    date: '2026-03-11',
    time: '09:40',
    tags: ['calidad', 'validacion', 'hplc'],
    summary: 'Recalificacion operacional del cromatografo tras el hallazgo del OOS.',
    contexto:
      'A partir de la investigacion del lote AMX-2401 se reviso el estado de calificacion del cromatografo principal del laboratorio de control. Se evaluo el alcance de la recalificacion y su impacto sobre los lotes analizados en el periodo afectado.',
    decisiones: [
      'Se ejecuta una recalificacion operacional completa antes de volver a usar el equipo en liberacion.',
      'Se revisan los lotes analizados desde la ultima calibracion valida para evaluar impacto retrospectivo.'
    ],
    pendientes: [
      { accion: 'Ejecutar el protocolo de recalificacion operacional', responsable: 'Metrologia', fecha: '25/03/2026' },
      { accion: 'Listar los lotes analizados en el periodo afectado', responsable: 'Control de Calidad', fecha: '18/03/2026' }
    ],
    referencias: [],
    relacionados: ['Investigacion OOS valoracion lote AMX-2401']
  },
  {
    title: 'CAPA-2026-014 frecuencia de calibracion',
    folder: 'Calidad',
    date: '2026-03-20',
    time: '15:05',
    tags: ['calidad', 'capa', 'validacion'],
    summary: 'Accion correctiva sobre la frecuencia de calibracion y la verificacion intermedia de equipos analiticos.',
    contexto:
      'La investigacion del OOS del lote AMX-2401 mostro que la frecuencia de calibracion del HPLC principal no contemplaba verificaciones intermedias. Se abrio una CAPA para corregir el esquema de calibracion de los equipos analiticos criticos.',
    decisiones: [
      'Se incorpora una verificacion intermedia mensual para los equipos analiticos criticos.',
      'Se agrega un alerta automatica a 30 dias del vencimiento de cada calibracion.'
    ],
    pendientes: [
      { accion: 'Actualizar el procedimiento de calibracion de equipos analiticos', responsable: 'Calidad', fecha: '30/04/2026' },
      { accion: 'Configurar las alertas de vencimiento en el sistema', responsable: 'TI', fecha: '15/05/2026' }
    ],
    referencias: [],
    relacionados: ['Investigacion OOS valoracion lote AMX-2401', 'Calificacion del HPLC del laboratorio de control', 'Migracion del sistema de gestion documental']
  },
  {
    title: 'Validacion de limpieza de la linea de solidos',
    folder: 'Calidad',
    date: '2026-04-02',
    time: '11:20',
    tags: ['calidad', 'limpieza', 'validacion', 'gmp'],
    summary: 'Estrategia de validacion de limpieza para la linea de solidos orales tras el cambio de campania.',
    contexto:
      'Se definio la estrategia de validacion de limpieza de la linea de solidos orales considerando el peor caso por solubilidad y potencia. El alcance incluye el cambio de campania entre productos de distinta familia terapeutica.',
    decisiones: [
      'El peor caso se define por solubilidad y dosis diaria maxima, no solo por potencia.',
      'Se valida por triplicado en tres campanias consecutivas.'
    ],
    pendientes: [
      { accion: 'Redactar el protocolo de validacion de limpieza', responsable: 'Calidad', fecha: '30/04/2026' },
      { accion: 'Definir el metodo analitico de recuperacion de residuos', responsable: 'Control de Calidad', fecha: '15/05/2026' }
    ],
    referencias: [],
    relacionados: ['Protocolo de muestreo de residuos por hisopado', 'Transferencia tecnologica a la planta de solidos']
  },
  {
    title: 'Protocolo de muestreo de residuos por hisopado',
    folder: 'Calidad',
    date: '2026-04-15',
    time: '14:00',
    tags: ['calidad', 'limpieza', 'protocolo'],
    summary: 'Definicion de puntos de muestreo y criterios de recuperacion para el hisopado de equipos.',
    contexto:
      'Como parte de la validacion de limpieza de la linea de solidos se definieron los puntos criticos de muestreo por hisopado y el porcentaje minimo de recuperacion aceptable del metodo analitico.',
    decisiones: [
      'Se definen doce puntos de muestreo, priorizando zonas de dificil acceso.',
      'La recuperacion minima aceptable del metodo se fija en 70 por ciento.'
    ],
    pendientes: [
      { accion: 'Ejecutar el estudio de recuperacion sobre acero inoxidable', responsable: 'Control de Calidad', fecha: '30/05/2026' }
    ],
    referencias: [],
    relacionados: ['Validacion de limpieza de la linea de solidos']
  },
  {
    title: 'Reformulacion de ibuprofeno 400 mg comprimidos',
    folder: 'I+D',
    date: '2026-02-10',
    time: '16:30',
    tags: ['id', 'formulacion', 'galenico'],
    summary: 'Cambio de agente desintegrante para mejorar el perfil de disolucion.',
    contexto:
      'El perfil de disolucion de ibuprofeno 400 mg comprimidos mostraba variabilidad entre lotes en el punto de 30 minutos. Se evaluo el reemplazo del agente desintegrante y el ajuste de la fuerza de compresion.',
    decisiones: [
      'Se reemplaza el desintegrante por croscarmelosa sodica al 4 por ciento.',
      'Se ajusta la fuerza de compresion para mantener la dureza dentro del rango objetivo.'
    ],
    pendientes: [
      { accion: 'Fabricar tres lotes piloto con la formula ajustada', responsable: 'I+D', fecha: '28/02/2026', hecho: true },
      { accion: 'Comparar perfiles de disolucion contra el producto de referencia', responsable: 'I+D', fecha: '15/03/2026', hecho: true }
    ],
    referencias: [],
    relacionados: ['Estudio de estabilidad acelerada de ibuprofeno 400 mg', 'Transferencia tecnologica a la planta de solidos']
  },
  {
    title: 'Estudio de estabilidad acelerada de ibuprofeno 400 mg',
    folder: 'I+D',
    date: '2026-03-25',
    time: '10:00',
    tags: ['id', 'estabilidad', 'formulacion'],
    summary: 'Resultados a tres meses en condiciones aceleradas de la formula reformulada.',
    contexto:
      'Se evaluaron los lotes piloto de la formula reformulada de ibuprofeno 400 mg en condiciones aceleradas. Se analizaron valoracion, productos de degradacion y perfil de disolucion a los tres meses.',
    decisiones: [
      'Los resultados a tres meses se mantienen dentro de especificacion en los tres lotes.',
      'Se continua con el estudio a largo plazo sin cambios de formula.'
    ],
    pendientes: [
      { accion: 'Analizar el punto de seis meses en condiciones aceleradas', responsable: 'Control de Calidad', fecha: '30/06/2026' }
    ],
    referencias: [],
    relacionados: ['Reformulacion de ibuprofeno 400 mg comprimidos', 'Reporte periodico de seguridad de ibuprofeno 2025']
  },
  {
    title: 'Transferencia tecnologica a la planta de solidos',
    folder: 'Produccion',
    date: '2026-04-22',
    time: '09:15',
    tags: ['produccion', 'ipc', 'batch-record'],
    summary: 'Plan de transferencia de la formula reformulada de I+D a produccion.',
    contexto:
      'Se planifico la transferencia tecnologica de la formula reformulada de ibuprofeno 400 mg desde I+D a la planta de solidos, incluyendo controles en proceso y criterios de aceptacion para los lotes de escalado.',
    decisiones: [
      'Se transfieren tres lotes a escala industrial antes de la validacion de proceso.',
      'Los controles en proceso incluyen dureza, friabilidad y uniformidad de masa cada 30 minutos.'
    ],
    pendientes: [
      { accion: 'Emitir el batch record maestro de la nueva formula', responsable: 'Produccion', fecha: '30/05/2026' },
      { accion: 'Capacitar a los operadores en el nuevo procedimiento', responsable: 'Produccion', fecha: '15/06/2026' }
    ],
    referencias: [],
    relacionados: ['Reformulacion de ibuprofeno 400 mg comprimidos', 'Validacion de limpieza de la linea de solidos']
  },
  {
    title: 'Respuesta a observaciones de MSP sobre el dossier de amoxicilina',
    folder: 'Regulatorios',
    date: '2026-04-08',
    time: '17:45',
    tags: ['regulatorios', 'msp', 'dossier'],
    summary: 'Estrategia de respuesta a las observaciones sobre datos de estabilidad y control de calidad.',
    contexto:
      'La autoridad sanitaria emitio observaciones sobre el dossier de renovacion de amoxicilina 500 mg capsulas, centradas en los datos de estabilidad y en la trazabilidad de los ensayos de valoracion. Se definio la estrategia de respuesta y la documentacion de respaldo.',
    decisiones: [
      'Se responde adjuntando los datos de estabilidad a largo plazo de los tres ultimos lotes.',
      'Se incluye la investigacion del OOS del lote AMX-2401 como evidencia de control del proceso.'
    ],
    pendientes: [
      { accion: 'Compilar los datos de estabilidad a largo plazo', responsable: 'Regulatorios', fecha: '30/04/2026', hecho: true },
      { accion: 'Presentar la respuesta formal ante la autoridad', responsable: 'Regulatorios', fecha: '20/05/2026' }
    ],
    referencias: [],
    relacionados: ['Dossier de renovacion de amoxicilina 500 mg', 'Investigacion OOS valoracion lote AMX-2401']
  },
  {
    title: 'Dossier de renovacion de amoxicilina 500 mg',
    folder: 'Regulatorios',
    date: '2026-01-28',
    time: '11:00',
    tags: ['regulatorios', 'dossier', 'rcp'],
    summary: 'Armado del expediente de renovacion quinquenal del registro sanitario.',
    contexto:
      'Se preparo el expediente de renovacion del registro sanitario de amoxicilina 500 mg capsulas, con la actualizacion del resumen de caracteristicas del producto y los datos de calidad del quinquenio.',
    decisiones: [
      'Se actualiza el resumen de caracteristicas del producto con la informacion de seguridad del periodo.',
      'Se presenta el expediente con noventa dias de anticipacion al vencimiento.'
    ],
    pendientes: [],
    referencias: [],
    relacionados: ['Respuesta a observaciones de MSP sobre el dossier de amoxicilina', 'Armonizacion Mercosur de rotulado']
  },
  {
    title: 'Armonizacion Mercosur de rotulado',
    folder: 'Regulatorios',
    date: '2026-05-06',
    time: '13:30',
    tags: ['regulatorios', 'mercosur', 'rcp'],
    summary: 'Impacto de los requisitos armonizados de rotulado sobre la cartera de productos.',
    contexto:
      'Se analizo el impacto de los requisitos armonizados de rotulado sobre los productos con registro vigente, priorizando los que vencen en el proximo ano. El analisis quedo pendiente de confirmacion normativa.',
    decisiones: [
      'Se prioriza la adecuacion de los productos con renovacion en los proximos doce meses.',
      'La adecuacion de los demas se agenda para el siguiente ciclo de actualizacion.'
    ],
    pendientes: [
      { accion: 'Confirmar el plazo de adecuacion con la autoridad', responsable: 'Regulatorios', fecha: '30/06/2026' }
    ],
    referencias: [],
    relacionados: ['Dossier de renovacion de amoxicilina 500 mg'],
    tipoSeccion: 'conclusiones'
  },
  {
    title: 'Reporte periodico de seguridad de ibuprofeno 2025',
    folder: 'Farmacovigilancia',
    date: '2026-02-19',
    time: '15:50',
    tags: ['farmacovigilancia', 'psur', 'evento-adverso'],
    summary: 'Cierre del reporte periodico de seguridad del ejercicio 2025 sin cambios en el perfil.',
    contexto:
      'Se consolidaron los eventos adversos reportados durante 2025 para ibuprofeno 400 mg comprimidos. Se evaluo si correspondia actualizar el perfil de seguridad del producto.',
    decisiones: [
      'No se identificaron senales nuevas durante el periodo.',
      'El perfil de seguridad se mantiene sin cambios respecto del reporte anterior.'
    ],
    pendientes: [
      { accion: 'Presentar el reporte consolidado', responsable: 'Farmacovigilancia', fecha: '31/03/2026', hecho: true }
    ],
    referencias: [],
    relacionados: ['Procedimiento de gestion de eventos adversos', 'Estudio de estabilidad acelerada de ibuprofeno 400 mg'],
    tipoSeccion: 'conclusiones'
  },
  {
    title: 'Procedimiento de gestion de eventos adversos',
    folder: 'Farmacovigilancia',
    date: '2026-05-13',
    time: '10:25',
    tags: ['farmacovigilancia', 'evento-adverso', 'sop'],
    summary: 'Actualizacion de los plazos internos de recepcion y evaluacion de eventos adversos.',
    contexto:
      'Se reviso el procedimiento de gestion de eventos adversos para alinear los plazos internos con los requisitos de reporte a la autoridad y con el nuevo circuito documental.',
    decisiones: [
      'Los eventos graves se evaluan dentro de las 24 horas de recibidos.',
      'La recepcion se centraliza en una unica casilla con acuse automatico.'
    ],
    pendientes: [
      { accion: 'Capacitar a la fuerza de ventas en el circuito de reporte', responsable: 'Farmacovigilancia', fecha: '30/06/2026' }
    ],
    referencias: [],
    relacionados: ['Reporte periodico de seguridad de ibuprofeno 2025', 'Migracion del sistema de gestion documental']
  },
  {
    title: 'Migracion del sistema de gestion documental',
    folder: 'TI',
    date: '2026-05-20',
    time: '08:50',
    tags: ['ti', 'validacion', 'sop'],
    summary: 'Plan de migracion del gestor documental con validacion del sistema computarizado.',
    contexto:
      'Se planifico la migracion del sistema de gestion documental a la nueva plataforma, incluyendo la validacion del sistema computarizado y la preservacion de la trazabilidad de las versiones aprobadas.',
    decisiones: [
      'La migracion se hace por lotes, empezando por los procedimientos de calidad.',
      'Se conserva el sistema anterior en modo lectura durante seis meses.'
    ],
    pendientes: [
      { accion: 'Redactar el plan de validacion del sistema computarizado', responsable: 'TI', fecha: '30/06/2026' },
      { accion: 'Definir el mapeo de metadatos entre los dos sistemas', responsable: 'TI', fecha: '15/07/2026' }
    ],
    referencias: [],
    relacionados: ['Procedimiento de gestion de eventos adversos', 'CAPA-2026-014 frecuencia de calibracion']
  }
];

function main(): void {
  const app = createApp();
  let created = 0;
  let skipped = 0;

  for (const seed of NOTES) {
    if (getNoteByTitle(app.db, seed.title)) {
      skipped += 1;
      continue;
    }
    const { date, time, ...input } = seed;
    const result = app.services.saveNote(input);
    // El servidor sella la fecha de hoy; para el ejemplo interesa que esten repartidas.
    app.db
      .prepare('UPDATE notes SET date = ?, time = ?, created_at = ?, updated_at = ? WHERE id = ?')
      .run(date, time, `${date}T${time}:00-03:00`, `${date}T${time}:00-03:00`, result.note.id);
    created += 1;
  }

  const counts = app.db.prepare('SELECT count(*) AS notas FROM notes').get() as { notas: number };
  const links = app.db.prepare('SELECT count(*) AS total FROM links WHERE to_note_id IS NOT NULL').get() as {
    total: number;
  };
  const pending = app.db.prepare('SELECT count(*) AS total FROM pending_items WHERE done = 0').get() as {
    total: number;
  };

  console.log(`Notas creadas: ${created}${skipped > 0 ? ` (${skipped} ya existian, se saltearon)` : ''}`);
  console.log(`Total en el vault: ${counts.notas} notas, ${links.total} enlaces resueltos, ${pending.total} pendientes abiertos`);
  console.log(`Base: ${app.config.dbPath}`);
  app.close();
}

main();
