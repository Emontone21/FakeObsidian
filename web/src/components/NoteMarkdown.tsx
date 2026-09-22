import type { OutLink } from '@bitacora/shared';
import { useMemo, type ComponentProps } from 'react';
import Markdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { Link } from 'react-router-dom';
import remarkGfm from 'remark-gfm';

/* eslint-disable @typescript-eslint/no-explicit-any */

const WIKILINK = /(!?)\[\[([^[\]|]+)(?:\|([^[\]]*))?\]\]/g;

/** Prefijo de la clase que lleva el indice del pendiente dentro del body. */
const TASK_CLASS = 'bitacora-task-';

/**
 * El cuerpo de una nota puede traer HTML crudo: la transcripcion importada usa
 * <details> para el bloque plegable. rehype-raw lo interpreta y rehype-sanitize
 * lo limpia, porque ese contenido sale de conversaciones y no es confiable.
 * Se extiende el esquema por defecto solo con lo que necesita el render propio.
 */
/**
 * Habilita propiedades reemplazando la entrada previa.
 * El esquema por defecto restringe `className` con tuplas del tipo
 * ["className", "valor-permitido"], asi que agregar el nombre al lado no
 * alcanza: hay que sacar la tupla o el valor propio queda filtrado.
 */
function allow(entries: unknown[] | undefined, ...names: string[]): unknown[] {
  const kept = (entries ?? []).filter((entry) => {
    const property = Array.isArray(entry) ? entry[0] : entry;
    return !names.includes(property as string);
  });
  return [...kept, ...names];
}

const SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    a: allow(defaultSchema.attributes?.a as unknown[], 'className', 'title'),
    li: allow(defaultSchema.attributes?.li as unknown[], 'className'),
    span: allow(defaultSchema.attributes?.span as unknown[], 'className')
  }
};

function titleKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Convierte los [[wikilinks]] en enlaces y numera los checkboxes.
 * Trabaja sobre nodos de texto del arbol, asi que lo que esta dentro de un
 * bloque de codigo (que no es un nodo `text`) queda intacto solo.
 *
 * Es un "attacher" de unified: se pasa como tupla [plugin, opciones] y unified
 * lo invoca para obtener el transformador. No hay que llamarlo a mano.
 */
function remarkBitacora({ resolveTo }: { resolveTo: Map<string, string> }) {
  return (tree: any) => {
    let taskIndex = 0;

    const walk = (node: any) => {
      if (node.type === 'listItem' && typeof node.checked === 'boolean') {
        // El indice viaja en className y no en un data-*: rehype-raw reserializa
        // el arbol y los data-* propios no sobreviven ese ida y vuelta.
        node.data = node.data ?? {};
        node.data.hProperties = {
          ...node.data.hProperties,
          className: ['task-list-item', `${TASK_CLASS}${taskIndex++}`]
        };
      }
      if (!Array.isArray(node.children)) return;

      const out: any[] = [];
      for (const child of node.children) {
        if (child.type !== 'text') {
          walk(child);
          out.push(child);
          continue;
        }

        const text: string = child.value;
        let last = 0;
        WIKILINK.lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = WIKILINK.exec(text)) !== null) {
          if (match.index > last) out.push({ type: 'text', value: text.slice(last, match.index) });
          const target = match[2]!.trim();
          const label = match[3]?.trim() || target;
          const id = resolveTo.get(titleKey(target));
          out.push({
            type: 'link',
            url: id ? `/nota/${id}` : '',
            title: id ? null : 'Esta nota todavía no existe',
            data: { hProperties: { className: id ? 'wikilink' : 'wikilink unresolved' } },
            children: [{ type: 'text', value: label }]
          });
          last = match.index + match[0].length;
        }

        if (last === 0) out.push(child);
        else if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
      }
      node.children = out;
    };

    walk(tree);
  };
}

interface NoteMarkdownProps {
  body: string;
  outlinks: OutLink[];
  /** Pendientes en el mismo orden en que aparecen en el body. */
  onToggleTask?: (index: number, done: boolean) => void;
}

export function NoteMarkdown({ body, outlinks, onToggleTask }: NoteMarkdownProps) {
  // Estable entre renders: si cambia la referencia, react-markdown re-parsea todo.
  const resolveTo = useMemo(() => {
    const map = new Map<string, string>();
    for (const link of outlinks) {
      if (link.note) map.set(titleKey(link.targetTitle), link.note.id);
    }
    return map;
  }, [outlinks]);

  const remarkPlugins = useMemo(() => [remarkGfm, [remarkBitacora, { resolveTo }] as const], [resolveTo]);
  // El orden importa: primero se parsea el HTML crudo, despues se sanitiza.
  const rehypePlugins = useMemo(() => [rehypeRaw, [rehypeSanitize, SANITIZE_SCHEMA] as const], []);

  return (
    <div className="markdown">
      <Markdown
        remarkPlugins={remarkPlugins as never}
        rehypePlugins={rehypePlugins as never}
        components={{
          a({ href, className, children, ...rest }: ComponentProps<'a'>) {
            if (className?.includes('unresolved')) {
              return (
                <span className={className} title="Esta nota todavía no existe">
                  {children}
                </span>
              );
            }
            if (href?.startsWith('/')) {
              return (
                <Link to={href} className={className ?? ''}>
                  {children}
                </Link>
              );
            }
            return (
              <a href={href} className={className} target="_blank" rel="noreferrer" {...rest}>
                {children}
              </a>
            );
          },
          li(props: any) {
            const classes = typeof props.className === 'string' ? props.className.split(/\s+/) : [];
            const marker = classes.find((c: string) => c.startsWith(TASK_CLASS));
            if (marker === undefined || !onToggleTask) {
              const { node: _node, ...rest } = props;
              return <li {...rest} />;
            }
            const index = Number(marker.slice(TASK_CLASS.length));
            // remark-gfm mete su propio <input disabled>; lo reemplazamos por uno vivo.
            const children = Array.isArray(props.children) ? props.children : [props.children];
            const checked = findCheckedState(children);
            return (
              <li className="task-list-item">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => onToggleTask(index, event.target.checked)}
                />
                {children.filter((child: any) => !isCheckboxInput(child))}
              </li>
            );
          }
        }}
      >
        {body}
      </Markdown>
    </div>
  );
}

function isCheckboxInput(child: any): boolean {
  return Boolean(child) && typeof child === 'object' && child.props?.type === 'checkbox';
}

function findCheckedState(children: any[]): boolean {
  for (const child of children) {
    if (isCheckboxInput(child)) return Boolean(child.props.checked);
  }
  return false;
}
