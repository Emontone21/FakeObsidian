---
name: guardar-en-bitacora
description: Guardar conversaciones de Claude en Bitácora, la base de conocimiento personal del usuario, usando el conector MCP y una plantilla estructurada (contexto, decisiones, pendientes, referencias). Usá este skill SIEMPRE que el usuario pida "guardar", "archivar", "registrar", "documentar" o "anotar" la conversación, el chat, las conclusiones o las decisiones en Bitácora, en el vault, en notas o "para después". También usalo de forma proactiva cuando la conversación contenga decisiones técnicas, conclusiones regulatorias, planes de acción, hallazgos de calidad, análisis de desviaciones, o cualquier contenido valioso que el usuario probablemente quiera conservar — en ese caso ofrecé guardarlo en lugar de hacerlo sin consultar. Requiere el conector MCP de Bitácora conectado.
---

# Guardar en Bitácora

Bitácora es la base de conocimiento personal del usuario: notas estructuradas de sus
conversaciones con Claude, enlazadas entre sí con `[[wikilinks]]` al estilo Obsidian.

**La diferencia clave con guardar archivos sueltos: vos no escribís markdown.**
Le mandás campos estructurados a `save_note` y el servidor renderiza la plantilla,
le pone fecha y hora, normaliza los tags, arma los wikilinks y recalcula el grafo.

## Cuándo activar este skill

**Disparo explícito (guardar sin preguntar si se quiere guardar):**

- "Guardá esto en Bitácora"
- "Archivá la conversación"
- "Registrá esto en mi vault"
- "Anotá las decisiones / conclusiones"
- "Documentá esto para después"

**Disparo proactivo (ofrecer, no guardar sin pedir):**

Cuando la conversación tenga material que el usuario va a querer conservar:

- Decisiones técnicas (formulación, validación, cambios de proceso)
- Conclusiones regulatorias o respuestas a observaciones de autoridades
- Análisis de desviaciones, OOS, OOT, CAPA
- Planes de acción con responsables y fechas
- Hallazgos de auditorías o inspecciones
- Borradores de SOPs, protocolos, informes
- Investigaciones largas con conclusiones útiles

Cerrá la respuesta con una oferta breve:

> ¿Querés que lo guarde en Bitácora? Lo archivaría en `Calidad` con el resumen de la
> decisión, los pendientes y las referencias.

**No disparar:** charlas casuales, preguntas puntuales sin contenido reutilizable, o
cuando el usuario ya dijo que no en esta conversación.

## Flujo de trabajo

### 1. Mirar la taxonomía que ya existe

```
list_folders()
list_tags()
```

Reusá una carpeta y tags existentes. Solo creá algo nuevo si ninguno encaja: el valor
del vault está en que `Regulatorios` sea siempre `Regulatorios` y no aparezca un
`Regulatorio` al lado. `save_note` crea la carpeta si no existe y te avisa — si te
avisó y vos esperabas reusar una, revisá que no hayas escrito mal el nombre.

Mapeo orientativo, ajustable al contexto real:

| Tema | Carpeta |
|---|---|
| Investigación, formulación, desarrollo galénico, estabilidad | `I+D` |
| Dossiers, registros sanitarios, respuestas a MSP/ANMAT/ANVISA/Mercosur | `Regulatorios` |
| GMP, desviaciones, CAPA, OOS, OOT, validaciones, auditorías | `Calidad` |
| Eventos adversos, RCP, reportes periódicos de seguridad | `Farmacovigilancia` |
| Producción, batch records, IPC, optimización de procesos | `Produccion` |
| Precios, licitaciones, estrategia comercial | `Comercial` |
| Marketing, materiales promocionales | `Marketing` |
| Sistemas, infraestructura, software | `TI` |
| Misceláneo | `General` |

### 2. Buscar notas relacionadas

```
search_notes(query="<palabras clave del tema>")
```

Esto es lo que mantiene vivo el grafo. Pasá los títulos que encuentres en
`relacionados`: el servidor los convierte en `[[wikilinks]]`. Si enlazás a una nota que
todavía no existe, queda como enlace sin resolver y se conecta sola el día que la crees.

Vale la pena buscar por más de un término (el producto, el área, la norma) antes de
concluir que no hay nada relacionado.

### 3. Guardar

```
save_note({
  title, folder, tags[], summary,
  contexto, decisiones[], pendientes[], referencias[],
  notas_adicionales?, relacionados[], tipo_seccion?
})
```

Cómo llenar cada campo:

- **title** — 4 a 10 palabras, descriptivo, **sin la fecha adelante** (la fecha la pone
  el servidor). Los títulos son únicos en todo el vault: si ya existe uno igual, el
  servidor agrega ` (2)` y te lo informa en `avisos`.
- **summary** — una o dos oraciones. Es lo que se ve en las tarjetas y en los tooltips
  del grafo, así que tiene que valer por sí solo.
- **contexto** — 2 a 5 oraciones entendibles sin haber visto la conversación. Incluí
  producto, lote, área o norma si corresponde.
- **decisiones** — una decisión o acuerdo por elemento, sin la viñeta inicial.
- **pendientes** — `{accion, responsable?, fecha?}`, solo lo que se acordó de verdad.
  La fecha va en `DD/MM/AAAA`; si mandás otro formato el tool lo rechaza.
- **referencias** — solo lo citado explícitamente en la conversación.
- **notas_adicionales** — razonamientos, alternativas descartadas, bloques de código,
  tablas, cálculos. No los resumas: el valor está en tenerlos textuales.
- **tipo_seccion** — `"conclusiones"` cuando hubo análisis pero ninguna decisión
  cerrada. Por defecto es `"decisiones"`.

### 4. Confirmar al usuario

`save_note` devuelve `id`, `title`, `folder`, `tags`, `url` y `avisos`. Respondé con:

- Confirmación breve y la carpeta donde quedó
- La **URL** de la nota
- Qué se archivó, en una oración
- Cualquier cosa que venga en `avisos` (renombre por título repetido, carpeta creada,
  enlaces sin resolver)
- Si anonimizaste datos personales, decilo

> Guardado en `Calidad` como "OOS de valoración lote AMX-2401":
> http://127.0.0.1:8787/nota/01J... Incluye el análisis de causa raíz, la decisión de
> re-muestreo y 3 pendientes para Producción. Lo enlacé con "Calificación del HPLC".

## Reglas de contenido

- **Español neutro, sin voseo**, en el contenido archivado: es material de referencia
  profesional. (Con el usuario hablá normal.)
- **Nunca inventes referencias.** Si en la conversación no se citaron normas,
  monografías, capítulos de farmacopea ni números de SOP, mandá `referencias: []`.
  Una cita inventada en una nota de calidad es peor que no tener nota.
- **Anonimizá datos personales** antes de enviarlos: pacientes, documentos de
  identidad, historias clínicas. Sustituí por `[ANONIMIZADO]` o `[PACIENTE-001]` y
  avisale al usuario qué anonimizaste.
- Unidades SI. Terminología estándar (API, GMP, CAPA, OOS, OOT, batch record, dossier,
  RCP, IPC).
- En decisiones críticas (liberación de lotes, respuestas a autoridades, retiros),
  aclaralo: el contenido archivado es asistencia, la firma es humana.

## Agregar a una nota que ya existe

Si el tema continúa una nota anterior, **no crees una nota nueva**: sumale contenido.

```
append_to_note(id, section="Decisiones", markdown="- La decisión nueva.")
append_to_note(id, section="Pendientes", markdown="- [ ] Acción — Responsable — 30/06/2026")
```

`append_to_note` suma sin pisar. `update_note` **reemplaza** la sección entera: usalo
solo cuando querés corregir lo que había, no para agregar.

Para conectar dos notas ya guardadas sin reescribir nada:

```
link_notes(from_id, to_title="Título de la otra nota")
```

## Resumir notas importadas

Las notas que vienen del export de claude.ai quedan con la transcripción cruda, el tag
`sin-resumir` y `estado: sin resumir`. **Completarlas es trabajo tuyo, no del servidor:**
no hace falta ninguna clave de API, alcanza con los tools del conector.

El conector trae el prompt `resumir-importadas` con el procedimiento completo. Si el
usuario te lo pide en sus palabras («resumí las importadas», «completá las notas sin
resumir»), hacé lo mismo:

```
search_notes(tags=["sin-resumir"], limit=5)   # cuáles faltan
list_folders() ; list_tags()                  # una sola vez
get_note(id)                                  # la transcripción está en "Notas adicionales"
update_note(id, {title?, folder, tags, summary, contexto, decisiones,
                 pendientes, referencias, tipo_seccion?, status: "archivado"})
```

Tres cosas que importan:

- **No toques `notas_adicionales`.** Ahí vive la transcripción y tiene que quedar intacta:
  es el respaldo de lo que realmente se dijo.
- **En `tags`, conservá `import` y no incluyas `sin-resumir`.** La lista que mandás
  reemplaza a la anterior, así que omitirlo es lo que lo saca.
- **Andá de a pocas** (5 por defecto) y contale al usuario cuántas resumiste y cuántas
  quedan. Resumir 200 de una es una sesión eterna y él no puede revisar nada.

El título importado suele ser malo (genérico, o derivado del primer mensaje). Si es así,
mejoralo; si ya es descriptivo, no lo toques.

## Pendientes

```
list_pending(owner?, due_before?, note_id?)
complete_pending(pending_id)
```

`complete_pending` reescribe el `- [ ]` como `- [x]` en el cuerpo de la nota: la nota
es la fuente de verdad, no hay un estado paralelo. Si el usuario pregunta "qué tengo
pendiente", `list_pending` los trae de todas las notas con su nota de origen.

## Casos especiales

**El pedido es vago y la conversación es larga.** Preguntá antes de archivar:

> ¿Archivo la conversación entera o solo la parte de [tema que dominó la charla]?

**El usuario pide una carpeta específica.** Respetalo por encima del mapeo sugerido.

**El conector no responde.** Avisale al usuario, ofrecé darle el contenido como
markdown para que lo pegue a mano, y no reintentes en silencio más de una vez.

**Información muy sensible** (caso de farmacovigilancia con paciente identificable,
fórmula patentada crítica): anonimizá y preguntá si igual quiere guardarlo o si
prefiere el canal formal.

**Código o tablas largas.** Van textuales en `notas_adicionales`, dentro de bloques
de código. No los resumas.

## Recordá

- No escribas markdown: mandá campos estructurados y dejá que el servidor renderice.
- `list_folders` + `list_tags` + `search_notes` **antes** de `save_note`.
- Nunca inventes normas ni números de SOP.
- Anonimizá datos personales identificables.
- Pasale siempre la URL al usuario.
- Las notas se borran solo desde la web, nunca por MCP.
- Las notas importadas las resumís vos con `get_note` + `update_note`, sin clave de API.
