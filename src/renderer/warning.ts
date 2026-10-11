document.querySelector('#message')!.textContent = new URLSearchParams(location.search).get('message') ?? 'Скоро придёт Мурз.';
