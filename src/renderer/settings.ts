import type { SettingsBridge } from '../shared/types';
import { validateSettings, type SettingsErrors, type TimerSettings } from '../shared/timer-state';
import { murzCopy } from '../shared/murz-copy';

declare global { interface Window { murzSettings: SettingsBridge } }
const form = document.querySelector<HTMLFormElement>('#settings')!;
const save = document.querySelector<HTMLButtonElement>('#save')!;
const message = document.querySelector<HTMLDivElement>('#message')!;
const cancel = document.querySelector<HTMLButtonElement>('#cancel')!;
const fields = {} as Record<keyof TimerSettings, HTMLInputElement>;
const errors = {} as Record<keyof TimerSettings, HTMLElement>;
document.title = murzCopy.settings.title;
document.querySelector('#brand')!.textContent = murzCopy.brand;
document.querySelector('#heading')!.textContent = murzCopy.settings.heading;
document.querySelector('#subtitle')!.textContent = murzCopy.settings.subtitle;
document.querySelector('#future')!.textContent = murzCopy.settings.future;
save.textContent = murzCopy.buttons.save;
cancel.textContent = murzCopy.buttons.close;
const definitions = [
  ['workMinutes', 1, 240], ['shortMinutes', 1, 120], ['longMinutes', 1, 120],
  ['longEvery', 1, 24], ['warningMinutes', 0, 15],
] as const;
const container = document.querySelector('#fields')!;
for (const [key, min, max] of definitions) {
  const row = document.createElement('div'); row.className = 'field';
  const label = document.createElement('label'); label.htmlFor = key;
  label.textContent = murzCopy.settings.fields[key];
  const control = document.createElement('div'); control.className = 'control';
  const input = document.createElement('input');
  input.id = input.name = key; input.type = 'number'; input.min = String(min); input.max = String(max);
  input.step = '1'; input.required = true; input.disabled = true;
  const unit = document.createElement('span');
  unit.textContent = key === 'longEvery' ? murzCopy.settings.intervals : murzCopy.settings.minutes;
  const error = document.createElement('small'); error.className = 'error'; error.id = `${key}-error`;
  input.setAttribute('aria-describedby', error.id);
  if (key === 'warningMinutes') {
    const hint = document.createElement('span'); hint.className = 'hint'; hint.id = 'warning-hint';
    hint.textContent = murzCopy.settings.warningHint; label.append(hint);
    input.setAttribute('aria-describedby', `${hint.id} ${error.id}`);
  }
  fields[key] = input; errors[key] = error;
  control.append(input, unit); row.append(label, control, error); container.append(row);
}
const autoStart = document.querySelector<HTMLInputElement>('#autoStart')!;
fields.autoStart = autoStart;
errors.autoStart = document.querySelector('#autoStart-error')!;
document.querySelector('#autoStart-label')!.textContent = murzCopy.settings.fields.autoStart;
document.querySelector('#autoStart-hint')!.textContent = murzCopy.settings.autoStartHint;
const showWorkTimer = document.querySelector<HTMLInputElement>('#showWorkTimer')!;
fields.showWorkTimer = showWorkTimer;
errors.showWorkTimer = document.querySelector('#showWorkTimer-error')!;
document.querySelector('#showWorkTimer-label')!.textContent = murzCopy.settings.fields.showWorkTimer;
const keys = Object.keys(fields) as (keyof TimerSettings)[];
function showErrors(values: SettingsErrors = {}): void {
  for (const key of keys) {
    errors[key].textContent = values[key] ?? '';
    fields[key].setAttribute('aria-invalid', String(!!values[key]));
  }
}
void window.murzSettings.get().then(snapshot => {
  for (const [key] of definitions) fields[key].value = String(snapshot.settings[key]);
  autoStart.checked = snapshot.settings.autoStart;
  showWorkTimer.checked = snapshot.settings.showWorkTimer === true;
  for (const key of keys) fields[key].disabled = false;
  message.textContent = snapshot.loadWarning ?? '';
  save.disabled = false;
}).catch(() => { message.textContent = murzCopy.errors.loadSettings; });
cancel.addEventListener('click', () => window.murzSettings.close());
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (save.disabled) return;
  const input = { ...Object.fromEntries(definitions.map(([key]) => [key, fields[key].valueAsNumber])), autoStart: autoStart.checked, showWorkTimer: showWorkTimer.checked };
  const checked = validateSettings(input);
  if (!checked.ok) { showErrors(checked.errors); message.textContent = murzCopy.errors.checkFields; return; }
  showErrors();
  save.disabled = true;
  try {
    const result = await window.murzSettings.save(checked.settings);
    if (result.ok) window.murzSettings.close();
    else { showErrors(result.errors); message.textContent = result.error; }
  } catch { message.textContent = murzCopy.errors.saveSettings; }
  finally { save.disabled = false; }
});
