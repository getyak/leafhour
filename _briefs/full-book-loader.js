window.marginaliaContentReady = (async () => {
  const sample = JSON.parse(document.getElementById('mr-data').textContent);
  if (window.marginaliaEmbeddedBook) return window.marginaliaEmbeddedBook;
  try {
    const response = await fetch('../local/finite-infinite-games/book.json', {cache:'no-store'});
    if (!response.ok) return sample;
    const book = await response.json();
    if (book.bookId !== sample.bookId || book.schemaVersion !== 2 || !Array.isArray(book.chapters) || !Array.isArray(book.sections) || !Array.isArray(book.glossary) || !Array.isArray(book.annotations)) throw new Error('Invalid reading package');
    return book;
  } catch (error) {
    console.info('Full reading package is unavailable; showing the labelled sample.', error.message);
    return sample;
  }
})();
