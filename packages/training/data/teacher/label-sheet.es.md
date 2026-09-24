# Spanish label sheet for a teacher subagent

Read `label-sheet.md` first. The roles, the rules and the output format are the
same. This sheet adds what Spanish needs. Every example below was compiled and
gives the schedule shown, so copy these conventions exactly.

The compiler has the final say. A proposal is kept only when the labels compile
to the schedule you state. State the schedule from the meaning of the sentence,
never from what compiles. If you cannot express the meaning, return
`"schedule": "drop"`.

## Conventions

| Spanish                             | Labels                                                   | Schedule                                                                         |
| ----------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| hoy / ayer / mañana                 | `hoy`/REL_DAY                                            | `{"date":{"kind":"relativeDay","offset":0}}`                                     |
| anteayer, antes de ayer             | every word REL_DAY                                       | `offset: -2`                                                                     |
| pasado mañana                       | `pasado`/REL_DAY `mañana`/REL_DAY                        | `offset: 2`                                                                      |
| anoche                              | `anoche`/REL_DAY                                         | `offset: -1`                                                                     |
| ahora, ahora mismo, ya              | every word NOW                                           | `{"date":{"kind":"now"}}`                                                        |
| esta mañana, esta tarde, esta noche | `esta`/DEICTIC `mañana`/DAYPART                          | `{"date":{"kind":"relativeDay","offset":0},"time":{"start":{"part":"morning"}}}` |
| por la mañana, de la tarde (alone)  | `por`/O `la`/O `mañana`/DAYPART                          | `{"time":{"start":{"part":"morning"}}}`                                          |
| mañana por la mañana                | `mañana`/REL_DAY `por`/O `la`/O `mañana`/DAYPART         | `offset: 1` plus `part: "morning"`                                               |
| a las cinco                         | `a`/GLUE `las`/GLUE `cinco`/HOUR                         | `{"time":{"start":{"hour":5,"minute":0}}}`                                       |
| a las cinco de la tarde             | `de`/MERIDIEM `la`/MERIDIEM `tarde`/MERIDIEM             | `hour: 17`                                                                       |
| el lunes (one day)                  | `el`/O `lunes`/WEEKDAY                                   | `{"date":{"kind":"weekday","days":["MO"]}}`                                      |
| los lunes, los domingos (a habit)   | `los`/GLUE `domingos`/WEEKDAY                            | `{"recurrence":{"freq":"weekly","interval":1,"byDay":["SU"]}}`                   |
| todos los días                      | `todos`/RECUR `los`/RECUR `días`/UNIT                    | `{"recurrence":{"freq":"daily","interval":1}}`                                   |
| cada semana                         | `cada`/RECUR `semana`/UNIT                               | `{"recurrence":{"freq":"weekly","interval":1}}`                                  |
| la semana que viene                 | `la`/O `semana`/UNIT `que`/DEICTIC `viene`/DEICTIC       | `{"date":{"kind":"relativeUnit","unit":"week","modifier":"next"}}`               |
| el mes pasado                       | `el`/O `mes`/UNIT `pasado`/DEICTIC                       | `unit: "month", modifier: "last"`                                                |
| este año                            | `este`/DEICTIC `año`/UNIT                                | `unit: "year", modifier: "this"`                                                 |
| el fin de semana                    | `el`/O then `fin`, `de`, `semana` all DAYGROUP           | `{"date":{"kind":"dayGroup","group":"weekend"}}`                                 |
| hace tres días                      | `hace`/DIR_BEFORE `tres`/NUM `días`/UNIT                 | `{"shift":{"amount":3,"unit":"day","direction":"before"}}`                       |
| dentro de dos horas, en dos horas   | `dentro`/DIR_AFTER `de`/DIR_AFTER `dos`/NUM `horas`/UNIT | `direction: "after"`                                                             |
| para el lunes, antes del viernes    | the lead words O, only the date carries roles            | the plain date, as for "el lunes"                                                |

## Spanish rules

1. **"mañana" alone, or next to a day word, is tomorrow.** With an article or
   "esta" in front ("la mañana", "esta mañana", "por la mañana", "de la
   mañana") it is the morning: DAYPART or MERIDIEM, never REL_DAY.
2. **The article decides a habit.** "los lunes" and "todos los lunes" repeat
   every week. "el lunes" is one day.
3. **Past narration still counts.** "Ayer regresé de Boston" labels `Ayer`
   REL_DAY. A calendar can place a past date.
4. **Say no often.** These are not calendar times: "hoy en día", "hoy por hoy",
   "ahora bien", "por ahora", "hasta ahora", "de ahora en adelante", "a partir
   de ahora", "de la noche a la mañana", "hasta luego", "la mañana es fría".
   Return `"schedule": "none"` with no labels for a sentence that has only
   these. More traps that are `"none"`:
   - Greetings: "buenos días", "buenas tardes", "buenas noches".
   - "tarde" meaning late: "llegar tarde", "es tarde", "más tarde", "tarde o
     temprano", "se hace tarde".
   - Counting words: "una vez", "otra vez", "a veces", "cada vez más".
   - Numbers that count things: "las dos chicas", "los tres".
   - A vague amount: "hace unos años", "hace mucho tiempo", "hace poco".
   - A general fact: "el lunes viene después del domingo", "en verano hace
     calor".
5. **"hasta mañana" depends on the meaning.** As a goodbye ("¡Hasta mañana!",
   "Buenas noches y hasta mañana") it is `"none"`. As a limit ("puede esperar
   hasta mañana", "tienes hasta mañana para decidir") it is tomorrow: `hasta`
   O, `mañana` REL_DAY, schedule `offset: 1`.
6. **Only one expression.** If the sentence has two separate time
   expressions, return `"drop"`. Labelling only one would teach the model to
   skip the other.
7. **Do not invent.** Vague words ("pronto", "luego", "algún día", "un rato")
   are `"none"`.
8. **A lone "ahora" is always now.** "Hazlo ahora", "ahora es tarde", "¿qué
   haremos ahora?" all label `ahora` NOW. Only the fixed phrases in rule 4
   ("por ahora", "hasta ahora", "desde ahora", "ahora bien"...) are `"none"`.
   "hoy día" means nowadays, like "hoy en día": `"none"`.
9. **A day part is always a day part.** "por la mañana", "en la tarde", "de
   noche" label DAYPART even in a habit or a general sentence ("Tom se levanta
   temprano por la mañana"). A greeting ("buenos días", "¡buen fin de
   semana!") is still `"none"`.
10. **Months and weekends.** "en agosto", "ya es abril" label the month:
    `{"date":{"kind":"calendar","month":8}}`. "el próximo abril" is
    `{"date":{"kind":"calendarPeriod","month":4,"modifier":"next"}}`. "los
    fines de semana" is a habit:
    `{"recurrence":{"freq":"weekly","interval":1,"byDay":["SA","SU"]}}`.
