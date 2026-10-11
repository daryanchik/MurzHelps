import type { SettingsBridge } from '../shared/types';
import { validateSettings, type SettingsErrors, type TimerSettings } from '../shared/timer-state';

declare global { interface Window { murzSettings: SettingsBridge } }
const form = document.querySelector<HTMLFormElement>('#settings')!;
const save = document.querySelector<HTMLButtonElement>('#save')!;
const message = document.querySelector<HTMLDivElement>('#message')!;
const fields = {
  workMinutes: document.querySelector<HTMLInputElement>('#workMinutes')!,
  breakMinutes: document.querySelector<HTMLInputElement>('#breakMinutes')!,
  warningMinutes: document.querySelector<HTMLInputElement>('#warningMinutes')!,
};
const errors = {
  workMinutes: document.querySelector<HTMLElement>('#work-error')!,
  breakMinutes: document.querySelector<HTMLElement>('#break-error')!,
  warningMinutes: document.querySelector<HTMLElement>('#warning-error')!,
};
function showErrors(values: SettingsErrors = {}): void {
  for (const key of Object.keys(fields) as (keyof TimerSettings)[]) {
    errors[key].textContent = values[key] ?? '';
    fields[key].setAttribute('aria-invalid', String(!!values[key]));
  }
}
void window.murzSettings.get().then(snapshot => {
  for (const key of Object.keys(fields) as (keyof TimerSettings)[]) fields[key].value = String(snapshot.settings[key]);
  message.textContent = snapshot.loadWarning ?? '';
  save.disabled = false;
}).catch(() => { message.textContent = 'Не удалось загрузить настройки. Закройте окно и откройте его снова.'; });
document.querySelector('#cancel')!.addEventListener('click', () => window.murzSettings.close());
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (save.disabled) return;
  const input = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.valueAsNumber]));
  const checked = validateSettings(input);
  if (!checked.ok) { showErrors(checked.errors); message.textContent = 'Проверьте значения полей.'; return; }
  showErrors();
  save.disabled = true;
  try {
    const result = await window.murzSettings.save(checked.settings);
    if (result.ok) window.murzSettings.close();
    else { showErrors(result.errors); message.textContent = result.error; }
  } catch { message.textContent = 'Не удалось сохранить настройки. Повторите попытку.'; }
  finally { save.disabled = false; }
});
