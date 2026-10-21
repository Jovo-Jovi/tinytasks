# Design system

TinyTasks is a quiet dashboard for one developer. The shell is a light surface, left-to-right in English and right-to-left when Arabic is the active locale.

## Tokens

Defined in `src/app/globals.css`:

| Token | Value | Use |
| --- | --- | --- |
| `--surface` | `#ffffff` | Page background |
| `--text` | `#17202b` | Primary text |
| `--muted` | `#5c6b7a` | Secondary text and empty states |
| `--todo` | `#d97706` | Status Todo |
| `--progress` | `#2563eb` | Status In Progress |
| `--done` | `#15803d` | Status Done |
| `--danger` | `#b91c1c` | Error state and destructive actions |

Type is the system sans. Body text is 16px with relaxed leading. The page title is the only large heading.

## Layout

One column on a narrow screen. From the `md` breakpoint, the three statuses sit side by side. Padding stays at least 24px from the viewport edge. The content column maxes out near 48rem on a single-purpose screen and can grow to three equal columns on the board.

## Components

shadcn/ui is the kit. `components.json` points components at `src/components` and the class helper at `src/lib/utils.ts` (`cn`). Tailwind utilities style layout. Do not add a second component library.

Buttons use a filled primary action for create, a quiet action for edit, and the danger token for delete. Form fields show an error under the field, not only at the top of the form.

## States

- Loading: the board area shows a short line, "Loading", and does not flash an empty board.
- Empty: "No tasks yet" plus the create action.
- Error: the danger token, a retry action, and no silent failure.

Status labels come from `src/i18n`, not from hard-coded strings in components, once T01 builds the board.
