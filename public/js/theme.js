// Aplica o tema salvo antes de a página aparecer (evita "piscar" claro/escuro).
try {
  var savedTheme = localStorage.getItem("chef:theme");
  if (savedTheme === "dark" || savedTheme === "light") document.documentElement.setAttribute("data-theme", savedTheme);
} catch (e) { /* armazenamento indisponível: segue o tema do sistema */ }
