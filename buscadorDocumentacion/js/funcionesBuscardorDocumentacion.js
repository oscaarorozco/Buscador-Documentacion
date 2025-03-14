let docxFiles = []; // Lista de documentos .docx
let versionControlFiles = []; // Lista de archivos agregados al control de versiones
let loadedJSONData = []; // Datos cargados desde un JSON
let checkedCount = 0; // Contador de documentos checkeados
let leftFileContent = ''; // Contenido del archivo cargado en el lado izquierdo
let rightFileContent = ''; // Contenido del archivo cargado en el lado derecho

function normalizeText(text) {
    return text
        .normalize("NFD") // Descompone caracteres acentuados (e.g., á -> a + ´)
        .replace(/[\u0300-\u036f]/g, "") // Elimina signos ortográficos
        .toLowerCase(); // Convierte a minúsculas
}

// Función para resaltar coincidencias en el texto
function highlightMatches(text, searchText) {
    // Normalizar tanto el texto como el texto buscado para la comparación
    const normalizedText = normalizeText(text); // Texto original normalizado
    const normalizedSearchText = normalizeText(searchText); // Texto buscado normalizado

    // Escapar caracteres especiales en el texto buscado
    const escapedSearchText = normalizedSearchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Crear una expresión regular basada en el texto normalizado
    const regex = new RegExp(`(${escapedSearchText})`, 'gi');

    // Dividir el texto original en fragmentos (por líneas o párrafos)
    const fragments = text.split(/(\n|\r\n)/); // Dividir por saltos de línea

    // Procesar cada fragmento y aplicar el resaltado
    const highlightedFragments = fragments.map(fragment => {
        const normalizedFragment = normalizeText(fragment); // Normalizar el fragmento actual
        return normalizedFragment.replace(regex, '<span class="badge highlight">$1</span>');
    });

    // Unir los fragmentos resaltados y devolver el resultado
    return highlightedFragments.join('');
}

// Función para obtener metadatos del archivo
async function fileHandleToMetadata(fileHandle) {
    try {
        const file = await fileHandle.getFile(); // Obtener el objeto File desde el handle
        return {
            name: file.name, // Nombre del archivo
            size: file.size, // Tamaño en bytes
            lastModified: file.lastModified, // Fecha de última modificación (timestamp)
            type: file.type, // Tipo MIME del archivo
        };
    } catch (error) {
        console.error("Error al obtener metadatos del archivo:", error);
        return {}; // Retornar un objeto vacío si ocurre un error
    }
}

// Función recursiva para buscar archivos .docx en una carpeta y sus subcarpetas
async function getDocxFilesFromFolder(folderHandle) {
    let files = [];

    for await (const [name, handle] of folderHandle.entries()) {
        if (handle.kind === "file" && name.endsWith(".docx")) {
            const file = await handle.getFile();
            files.push({ file, handle }); // Guardar el archivo y su handle
        } else if (handle.kind === "directory") {
            // Llamada recursiva para explorar subcarpetas
            const subfolderFiles = await getDocxFilesFromFolder(handle);
            files = files.concat(subfolderFiles);
        }
    }

    return files;
}

// Función para calcular el porcentaje de similitud
function calculateSimilarity(original, search) {
    const originalWords = original.split(' ');
    const searchWords = search.split(' ');
    let matches = 0;

    searchWords.forEach(word => {
        if (originalWords.includes(word)) {
            matches++;
        }
    });

    return (matches / searchWords.length) * 100; // Retorna el porcentaje de coincidencia
}

// Función para calcular relevancia basada en coincidencias parciales
function calculateRelevance(searchText, paragraph) {
    const searchWords = searchText.split(/\s+/); // Palabras del texto buscado
    const paragraphWords = paragraph.split(/\s+/); // Palabras del párrafo

    let matches = 0;

    searchWords.forEach(word => {
        paragraphWords.forEach(paragraphWord => {
            if (paragraphWord.includes(word)) { // Coincidencia parcial
                matches++;
            }
        });
    });

    return (matches / searchWords.length) * 100; // Porcentaje de relevancia
}

// Evento principal (Botón buscar)
document.getElementById('searchBtn').addEventListener('click', async function () {
    const searchText = document.getElementById('searchInput').value.trim(); // Texto de entrada a buscar
    const sortOption = document.getElementById('sortOptions').value; // Obtener la opción seleccionada del menú desplegable
    const messageWindow = document.getElementById('messageWindow');
    const progressContainer = document.querySelector('.progress-container');

    if (!searchText) {
        showNotification("Por favor, escribe un párrafo o palabra para buscar.", "warning");
        return;
    }

    messageWindow.innerHTML = "";
    progressContainer.style.display = 'block';
    updateProgressBar(0);

    if (docxFiles.length === 0) {
        showNotification("Por favor, selecciona al menos una carpeta con archivos DOCX.", "warning");
        return;
    }

    const totalFiles = docxFiles.length;
    let processedFiles = 0;
    let results = []; // Almacena todos los resultados encontrados
    let checkedCount = 0;

    // Normalizar el texto buscado (sin mayúsculas/minúsculas ni acentos)
    const normalizedSearchText = normalizeText(searchText);

    // Escapar caracteres especiales en el texto buscado
    const escapedSearchText = normalizedSearchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    for (const { file, handle } of docxFiles) {
        const arrayBuffer = await file.arrayBuffer();

        try {
            // Convertir el archivo DOCX a texto plano
            const result = await mammoth.extractRawText({ arrayBuffer });
            const textContent = result.value;

            // Obtener metadatos del archivo
            const metadata = await fileHandleToMetadata(handle);

            // Dividir el contenido en líneas o párrafos
            const paragraphs = textContent.split(/\n+/).map(p => p.trim()).filter(p => p.length > 0);

            paragraphs.forEach((paragraph, index) => {
                // Normalizar el párrafo actual
                const normalizedParagraph = normalizeText(paragraph);

                // Crear una expresión regular para buscar coincidencias en el párrafo normalizado
                const regex = new RegExp(`(${escapedSearchText})`, 'gi');

                if (regex.test(normalizedParagraph)) {
                    // Calcular un "puntaje de relevancia" basado en las coincidencias encontradas
                    const similarityPercentage = calculateRelevance(normalizedSearchText, normalizedParagraph);

                    // Resaltar las coincidencias en el párrafo original (sin modificar su formato)
                    const highlightedParagraph = paragraph.replace(regex, '<span class="badge highlight">$1</span>');

                    results.push({
                        fileName: file.name,
                        paragraph: highlightedParagraph,
                        similarity: similarityPercentage,
                        metadata,
                        paragraphIndex: index,
                        page: Math.floor(index / 20) + 1
                    });
                }
            });

            processedFiles++;
            updateProgressBar((processedFiles / totalFiles) * 100);
        } catch (error) {
            console.error("Error al procesar el archivo:", error);
            processedFiles++;
            updateProgressBar((processedFiles / totalFiles) * 100);
        }
    }

    // Ordenar los resultados según la opción seleccionada
    if (sortOption === "similarity") {
        results.sort((a, b) => b.similarity - a.similarity); // Mayor a menor similitud
    } else if (sortOption === "date") {
        results.sort((a, b) => new Date(b.metadata.lastModified) - new Date(a.metadata.lastModified)); // Más reciente primero
    } else if (sortOption === "alphabetical") {
        results.sort((a, b) => a.fileName.localeCompare(b.fileName)); // Orden alfabético
    }

    // Mostrar los resultados ordenados y estructurados en HTML
    results.forEach(result => {
        const sanitizedFileName = result.fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-_]/g, ''); // Sanear el nombre del archivo
        const filePath = `${result.fileName}`; // Ajusta esta ruta según tu sistema

        messageWindow.insertAdjacentHTML('beforeend', `
            <div class="card mb-3" style="border: 1px solid #ccc; border-radius: 10px; background-color: #f8f9fa; padding: 15px;">
                <div class="d-flex justify-content-between align-items-center">
                    <!-- Información del documento -->
                    <div>
                        <h6 class="card-title mb-1 d-flex align-items-center">
                            <strong>Documento:</strong> 
                            <span class="text-primary ms-2">${result.fileName}</span>
                            <!-- Botón para copiar la ruta -->
                            <button class="btn btn-link btn-sm ms-3" onclick="copyToClipboard('${filePath}')">
                                <i class="bi bi-copy"></i> 
                            </button>
                        </h6>
                        <p class="mb-1 text-muted" style="font-size: 0.9rem;">
                            <strong>Párrafo:</strong> ${result.paragraphIndex + 1} | 
                            <strong>Página (Aproximada):</strong> ${result.page}
                        </p>
                        <p class="mb-1 text-muted" style="font-size: 0.9rem;">
                            <strong>Fecha (Última modificación):</strong> ${new Date(result.metadata.lastModified).toLocaleDateString()}
                        </p>
                    </div>
    
                    <!-- Checkboxes y botón para abrir en el controlador de versiones -->
                    <div>
                        <!-- Check para revisado -->
                        <input class="form-check-input custom-checkbox" type="checkbox" data-file-name="${sanitizedFileName}" data-paragraph-index="${result.paragraphIndex}" data-type="revisado">
                        <label class="ms-2">Revisado</label>
                        <br>
                        <!-- Check para editado -->
                        <input class="form-check-input custom-checkbox" type="checkbox" data-file-name="${sanitizedFileName}" data-paragraph-index="${result.paragraphIndex}" data-type="editado">
                        <label class="ms-2">Editado</label>
                        <br>
                        <!-- Botón para abrir en el controlador de versiones -->
                        <button class="btn btn-outline-secondary btn-sm mt-2 hb2 fs-6"
                                onclick="addToVersionControl('${result.fileName}', ${result.paragraphIndex})">
                            <i class="bi bi-plus"></i> Agregar versión
                        </button>
                    </div>
                </div>
    
                <!-- Texto del resultado -->
                <hr style="margin: 10px 0; border-top: 1px solid #ddd;">
                <p class="fst-italic mb-0" style="font-size: 0.95rem; color: #333;">"${result.paragraph}"</p>
            </div>
        `);
    });



    if (results.length === 0) {
        showNotification("No se encontraron coincidencias en los archivos procesados.", "info");
    }
});

// Función para abrir el archivo
async function openFile(fileName) {
    const fileToOpen = docxFiles.find(file => file.handle.name === fileName);
    if (fileToOpen) {
        try {
            // Mostrar la ruta del archivo al usuario
            const filePath = fileToOpen.handle.name; // Solo muestra el nombre del archivo
            showNotification(`Ruta del archivo: ${filePath}`, "info");

            // Copiar la ruta al portapapeles
            await navigator.clipboard.writeText(filePath);
            showNotification("La ruta del archivo se ha copiado al portapapeles.", "success");
        } catch (error) {
            console.error("Error al procesar el archivo:", error);
            showNotification("No se pudo procesar el archivo. Asegúrate de tener los permisos necesarios.", "error");
        }
    } else {
        showNotification("No se encontró el archivo especificado.", "error");
    }
}

// Función para actualizar la barra de progreso
function updateProgressBar(percentage) {
    const progressBar = document.querySelector('.progress-bar');
    const progressText = document.querySelector('.progress-text');
    const roundedPercentage = Math.round(percentage);

    progressBar.style.width = `${roundedPercentage}%`;
    progressBar.setAttribute('aria-valuenow', roundedPercentage);
    progressText.textContent = `${roundedPercentage}%`;
}

// Función para mostrar notificaciones
function showNotification(message, type = 'info') {
    const messageWindow = document.getElementById('messageWindow');
    const notificationElement = document.createElement('div');

    // Añadir clases de animación
    notificationElement.className = `alert alert-${type} mt-2 animate__animated animate__fadeInRight`;
    notificationElement.textContent = message;

    // Estilos adicionales para mejorar la animación
    notificationElement.style.animationDuration = '0.5s';

    messageWindow.appendChild(notificationElement);

    // Añadir animación de salida
    setTimeout(() => {
        notificationElement.classList.remove('animate__fadeInRight');
        notificationElement.classList.add('animate__fadeOutRight');

        // Eliminar el elemento después de la animación
        setTimeout(() => {
            notificationElement.remove();
        }, 5000);
    }, 5000);
}

// Función generar log
function generateLog() {
    const messageWindow = document.getElementById('messageWindow');
    if (!messageWindow) {
        console.error("El contenedor 'messageWindow' no existe.");
        alert("Error: No se encontró el contenedor de resultados.");
        return;
    }

    let logContent = "========== LOG ==========\n\n";

    // Archivos marcados como revisados
    logContent += "Archivos marcados como revisados:\n";
    const cards = messageWindow.querySelectorAll('.card'); // Seleccionar todas las tarjetas de resultados

    if (cards.length > 0) {
        cards.forEach(card => {
            const fileLabel = card.querySelector('span.text-primary'); // Obtener el nombre del archivo
            if (fileLabel) {
                const fileName = fileLabel.textContent.trim();

                // Verificar si está marcado como revisado
                const reviewedCheckbox = card.querySelector('input[data-type="revisado"]');
                const editedCheckbox = card.querySelector('input[data-type="editado"]');

                if (reviewedCheckbox && reviewedCheckbox.checked) {
                    logContent += `- ${fileName}`;

                    // Verificar si también está marcado como editado
                    if (editedCheckbox && editedCheckbox.checked) {
                        logContent += " (Editado)";
                    }
                    logContent += "\n";
                }
            }
        });
    } else {
        logContent += "No se han marcado documentos como revisados.\n";
    }

    logContent += "\n========== ARCHIVOS CON PÁRRAFOS ENCONTRADOS ==========\n\n";

    // Archivos con párrafos encontrados
    if (cards.length > 0) {
        cards.forEach(card => {
            const fileLabel = card.querySelector('span.text-primary'); // Obtener el nombre del archivo
            if (fileLabel) {
                const fileName = fileLabel.textContent.trim();

                // Extraer información del párrafo y similitud
                const paragraphText = card.querySelector('.fst-italic')?.textContent.trim() || "Texto no disponible";
                const similarityBadge = card.querySelector('.badge.bg-success')?.textContent.trim() || "0%";

                logContent += `${fileName}:\n`;
                logContent += `  - Párrafo: "${paragraphText}"\n`;

                // Verificar si está marcado como editado
                const editedCheckbox = card.querySelector('input[data-type="editado"]');
                if (editedCheckbox && editedCheckbox.checked) {
                    logContent += `  - Estado: Editado\n`;
                }
            }
        });
    } else {
        logContent += "No se encontraron coincidencias en los archivos procesados.\n";
    }

    // Crear y descargar el archivo de log
    try {
        const blob = new Blob([logContent], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `log_${new Date().toISOString().slice(0, 10)}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        console.log("Contenido del log generado:\n", logContent);
    } catch (error) {
        console.error("Error al generar o descargar el archivo de log:", error);
        alert("Ocurrió un error al generar el archivo de log.");
    }
}

// Función para mostrar el contenido del archivo seleccionado en el controlador de versiones
function showFileInVersionControl(fileName, plainTextContent) {
    const versionControlContainer = document.querySelector('.offcanvas-body.small');

    // Crear una card para mostrar el contenido del archivo
    const fileCard = document.createElement('div');
    fileCard.className = 'card mb-3';
    fileCard.style = 'border: 1px solid #ccc; border-radius: 10px; background-color: #f8f9fa; padding: 15px;';

    fileCard.innerHTML = `
        <div class="card-header d-flex justify-content-between align-items-center">
            <h6 class="card-title mb-0"><strong>Archivo:</strong> ${fileName}</h6>
            <button type="button" class="btn-close" aria-label="Close" onclick="this.closest('.card').remove();"></button>
        </div>
        <div class="card-body" style="max-height: 300px; overflow-y: auto;">
            <pre style="white-space: pre-wrap; word-wrap: break-word;">${plainTextContent}</pre>
        </div>
    `;

    // Agregar la card al controlador de versiones
    versionControlContainer.appendChild(fileCard);
}

// Función para abrir el archivo y mostrar su contenido en el controlador de versiones
async function openFile(fileName) {
    const fileToOpen = docxFiles.find(file => file.handle.name === fileName);
    if (fileToOpen) {
        try {
            const arrayBuffer = await fileToOpen.file.arrayBuffer();
            const result = await mammoth.extractRawText({ arrayBuffer });

            // Mostrar el contenido del archivo en el controlador de versiones
            showFileInVersionControl(fileToOpen.file.name, result.value);

            showNotification(`El archivo "${fileToOpen.file.name}" se ha cargado en el controlador de versiones.`, "success");
        } catch (error) {
            console.error("Error al procesar el archivo:", error);
            showNotification("No se pudo procesar el archivo. Asegúrate de tener los permisos necesarios.", "error");
        }
    } else {
        showNotification("No se encontró el archivo especificado.", "error");
    }
}

async function loadFileToVersionControl(fileName) {
    const fileToOpen = docxFiles.find(file => file.file.name === fileName);
    if (fileToOpen) {
        try {
            const arrayBuffer = await fileToOpen.file.arrayBuffer();
            const result = await mammoth.extractRawText({ arrayBuffer });

            // Crear el archivo .txt
            const blob = new Blob([result.value], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);

            // Mostrar la tarjeta en el controlador de versiones
            addFileCardToVersionControl(fileName, url);

            // Abrir automáticamente el controlador de versiones
            const versionControlOffcanvas = new bootstrap.Offcanvas(document.getElementById('offcanvasBottom'));
            versionControlOffcanvas.show();

            showNotification(`El archivo "${fileToOpen.file.name}" se ha cargado en el controlador de versiones.`, "success");
        } catch (error) {
            console.error("Error al procesar el archivo:", error);
            showNotification("No se pudo procesar el archivo. Asegúrate de tener los permisos necesarios.", "error");
        }
    } else {
        showNotification("No se encontró el archivo especificado.", "error");
    }
}

function updateCarouselActive() {
    const carouselInner = document.querySelector('#versionControlCarousel .carousel-inner');
    const items = carouselInner.querySelectorAll('.carousel-item');

    // Si no hay elementos activos, marca el primer slide como activo
    if (!carouselInner.querySelector('.carousel-item.active') && items.length > 0) {
        items[0].classList.add('active');
    }
}

function addFileCardToVersionControl(fileName, downloadUrl, plainTextContent) {
    const versionControlContainer = document.getElementById('versionControlContainer');

    // Verificar si ya existe una tarjeta para este archivo
    const existingCard = versionControlContainer.querySelector(`[data-file-name="${fileName}"]`);
    if (existingCard) {
        showNotification(`El archivo "${fileName}" ya está en el controlador de versiones.`, "info");
        return;
    }

    // Asegurarnos de que plainTextContent no sea undefined
    const safePlainTextContent = plainTextContent || "Contenido no disponible";

    // Crear la tarjeta
    const card = document.createElement('div');
    card.className = 'card text-center';
    card.setAttribute('data-file-name', fileName);
    card.setAttribute('data-plain-text', safePlainTextContent); // Guardar el texto plano como atributo

    card.innerHTML = `
        <div class="card-header d-flex justify-content-between align-items-center p-2">
            <h6 class="card-title mb-0"><strong>${fileName}</strong></h6>
            <button type="button" class="btn-close btn-sm ms-auto" aria-label="Close" onclick="this.closest('.card').remove();"></button>
        </div>
        <div class="card-body p-2">
            <a href="${downloadUrl}" download="${fileName.replace('.docx', '.txt')}" class="btn btn-outline-secondary btn-sm">
                Descargar TXT
            </a>
        </div>
    `;

    // Agregar la tarjeta al contenedor
    versionControlContainer.appendChild(card);
}

function copyToClipboard(filePath) {
    // Crear un elemento temporal de tipo input
    const tempInput = document.createElement('input');
    tempInput.value = filePath; // Asignar la ruta como valor
    document.body.appendChild(tempInput); // Agregarlo al DOM temporalmente
    tempInput.select(); // Seleccionar el contenido
    document.execCommand('copy'); // Copiar el contenido al portapapeles
    document.body.removeChild(tempInput); // Eliminar el elemento temporal

    // Mostrar una notificación o alerta
    showNotification(`Portapapeles: ${filePath}`, "success");
    alert(`Nombre copiado al portapapeles: ${filePath}`);
}

// Función para cargar un archivo JSON desde el sistema de archivos
async function loadJSONFile(event) {
    const file = event.target.files[0];
    if (!file) {
        showNotification("No se seleccionó ningún archivo.", "warning");
        return;
    }

    try {
        const text = await file.text();
        const jsonData = JSON.parse(text);

        // Validar que el JSON tenga la estructura esperada
        if (!Array.isArray(jsonData)) {
            showNotification("El archivo JSON no tiene la estructura esperada.", "error");
            return;
        }

        loadedJSONData = jsonData; // Guardar los datos cargados
        versionControlFiles = [...jsonData]; // Inicializar el control de versiones con los datos cargados

        updateVersionControlUI();
        showNotification("Archivo JSON cargado correctamente.", "success");
    } catch (error) {
        console.error("Error al cargar el archivo JSON:", error);
        showNotification("Error al cargar el archivo JSON.", "error");
    }
}

// Función para agregar un archivo al control de versiones y manejar múltiples versiones
async function addToVersionControl(fileName, index) {
    const fileToAdd = docxFiles.find(file => file.file.name === fileName);
    if (!fileToAdd) {
        showNotification(`El archivo "${fileName}" no se encontró.`, "warning");
        return;
    }

    const arrayBuffer = await fileToAdd.file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    const content = result.value;

    // Buscar si ya existe una entrada para este archivo en versionControlFiles
    const existingFile = versionControlFiles.find(file => file.fileName === fileName);

    if (existingFile) {
        // Si ya existe, agregar como una nueva versión con un identificador único
        versionControlFiles.push({
            fileName: fileToAdd.file.name,
            size: fileToAdd.file.size,
            lastModified: new Date(fileToAdd.file.lastModified).toISOString(),
            content: content,
            version: `v${versionControlFiles.filter(file => file.fileName === fileName).length + 1}`, // Incrementar versión
            parentFile: existingFile.fileName // Referencia al archivo principal
        });

        showNotification(`Nueva versión del archivo "${fileName}" agregada.`, "success");
    } else {
        // Si no existe, agregar como nuevo archivo principal
        versionControlFiles.push({
            fileName: fileToAdd.file.name,
            size: fileToAdd.file.size,
            lastModified: new Date(fileToAdd.file.lastModified).toISOString(),
            content: content,
            version: "v1",
            parentFile: null // No tiene un archivo principal porque es la primera versión
        });

        showNotification(`Archivo "${fileName}" agregado al control de versiones.`, "success");
        alert(`Archivo "${fileName}" agregado al control de versiones.`)
    }

    updateVersionControlUI();
}

// Función para actualizar la interfaz del control de versiones
function updateVersionControlUI() {
    const versionControlContainer = document.getElementById('versionControlContainer');
    versionControlContainer.innerHTML = ''; // Limpiar contenedor previo

    versionControlFiles.forEach((fileData) => {
        const parentInfo = fileData.parentFile ? `<p class="text-muted mb-1"><i class="bi bi-arrow-return-right"></i> Deriva de: ${fileData.parentFile}</p>` : "";

        const fileTitleElement = document.createElement('div');
        fileTitleElement.className = 'card mb-3';
        fileTitleElement.innerHTML = `
            <div class="card-body">
                <h5 class="card-title">${fileData.fileName}</h5>
                <p class="text-muted mb-1"><i class="bi bi-clock"></i> Última modificación: ${new Date(fileData.lastModified).toLocaleDateString()}</p>
                <p class="text-muted mb-1"><i class="bi bi-code-slash"></i> Versión: ${fileData.version}</p>
                ${parentInfo}
                <button class="btn btn-outline-danger btn-sm" onclick="removeFromVersionControl('${fileData.fileName}', '${fileData.version}')">
                    <i class="bi bi-trash"></i> Eliminar
                </button>
            </div>
        `;
        versionControlContainer.appendChild(fileTitleElement);
    });
}

// Función para eliminar un archivo o una versión del control de versiones
function removeFromVersionControl(fileName, version) {
    versionControlFiles = versionControlFiles.filter(file => !(file.fileName === fileName && file.version === version));
    updateVersionControlUI();
    showNotification(`Archivo "${fileName}" versión "${version}" eliminado del control de versiones.`, "info");
}

// Función para descargar el JSON actualizado con todas las versiones y metadatos en la misma altura
function downloadUpdatedJSON() {
    const jsonString = JSON.stringify(versionControlFiles, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `updated_metadata_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);

    showNotification("Archivo JSON actualizado descargado exitosamente.", "success");
}

// Función para llenar los selectores con los archivos disponibles
function populateFileSelectors() {
    const leftFileSelect = document.getElementById('leftFileSelect');
    const rightFileSelect = document.getElementById('rightFileSelect');

    // Limpiar selectores previos
    leftFileSelect.innerHTML = '<option value="">Seleccionar archivo</option>';
    rightFileSelect.innerHTML = '<option value="">Seleccionar archivo</option>';

    // Agregar opciones desde versionControlFiles
    versionControlFiles.forEach((file, idx) => {
        const optionLeft = document.createElement('option');
        const optionRight = document.createElement('option');

        optionLeft.value = idx;
        optionLeft.textContent = `${file.fileName} (${file.version})`;

        optionRight.value = idx;
        optionRight.textContent = `${file.fileName} (${file.version})`;

        leftFileSelect.appendChild(optionLeft);
        rightFileSelect.appendChild(optionRight);
    });
}

// Función para cargar un archivo DOCX y mostrarlo en el cuadro correspondiente
async function loadDocx(side) {
    try {
        const [fileHandle] = await window.showOpenFilePicker({
            types: [
                {
                    description: "Documentos Word",
                    accept: { "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"] }
                }
            ]
        });

        if (fileHandle) {
            const file = await fileHandle.getFile();
            const arrayBuffer = await file.arrayBuffer();

            // Usar Mammoth.js para extraer texto del DOCX
            const result = await mammoth.extractRawText({ arrayBuffer });
            const contentDivId = side === 'left' ? 'leftFileContent' : 'rightFileContent';
            document.getElementById(contentDivId).innerHTML = result.value.replace(/\n/g, '<br>'); // Mostrar contenido con saltos de línea

            // Guardar contenido en la variable correspondiente
            if (side === 'left') {
                leftFileContent = result.value;
            } else if (side === 'right') {
                rightFileContent = result.value;
            }
        }
    } catch (error) {
        console.error("Error al cargar el archivo DOCX:", error);
        showNotification("Error al cargar el archivo DOCX.", "error");
    }
}

// Función para cargar un archivo JSON y agregarlo al control de versiones
async function loadJSON(event) {
    const file = event.target.files[0];
    if (!file) {
        showNotification("No se seleccionó ningún archivo JSON.", "warning");
        return;
    }

    try {
        const text = await file.text();
        const jsonData = JSON.parse(text);

        if (!Array.isArray(jsonData)) {
            showNotification("El archivo JSON no tiene la estructura esperada.", "error");
            return;
        }

        versionControlFiles.push(...jsonData); // Agregar datos cargados al control de versiones

        updateVersionControlUI(); // Actualizar interfaz del control de versiones
        populateFileSelectors(); // Actualizar selectores en el modal

        showNotification("Archivo JSON cargado correctamente.", "success");
    } catch (error) {
        console.error("Error al cargar el archivo JSON:", error);
        showNotification("Error al cargar el archivo JSON.", "error");
    }
}

// Función para comparar dos archivos seleccionados o cargados manualmente
function compareFiles() {
    const leftFileIndex = document.getElementById('leftFileSelect').value;
    const rightFileIndex = document.getElementById('rightFileSelect').value;

    let leftContent, rightContent;

    // Determinar si usar contenido cargado manualmente o seleccionado del control de versiones
    if (leftFileIndex === '' && leftFileContent) {
        leftContent = leftFileContent; // Usar contenido cargado manualmente en el lado izquierdo
    } else if (leftFileIndex !== '') {
        leftContent = versionControlFiles[leftFileIndex].content; // Usar contenido del control de versiones
    } else {
        showNotification("Por favor, selecciona o carga un archivo en el lado izquierdo.", "warning");
        return;
    }

    if (rightFileIndex === '' && rightFileContent) {
        rightContent = rightFileContent; // Usar contenido cargado manualmente en el lado derecho
    } else if (rightFileIndex !== '') {
        rightContent = versionControlFiles[rightFileIndex].content; // Usar contenido del control de versiones
    } else {
        showNotification("Por favor, selecciona o carga un archivo en el lado derecho.", "warning");
        return;
    }

    // Obtener diferencias resaltadas
    const leftHighlightedText = highlightDifferences(leftContent, rightContent, '#00d886');
    const rightHighlightedText = highlightDifferences(rightContent, leftContent, '#cbd800');

    // Mostrar contenido resaltado en los contenedores
    document.getElementById('leftFileContent').innerHTML = leftHighlightedText;
    document.getElementById('rightFileContent').innerHTML = rightHighlightedText;

    // Mostrar diferencias línea por línea
    const differences = getLineByLineDifferences(leftContent, rightContent);
    document.getElementById('comparisonResult').innerHTML = `
        <h6>Diferencias Línea por Línea:</h6>
        <pre>${differences}</pre>
    `;
}

// Función para resaltar diferencias entre dos textos
function highlightDifferences(baseText, compareText, highlightColor) {
    const baseWords = baseText.split(/\s+/); // Dividir texto en palabras
    const compareWords = compareText.split(/\s+/);

    let highlightedText = '';

    baseWords.forEach((word, index) => {
        if (word !== compareWords[index]) {
            // Resaltar palabra diferente con negrita y color de fondo
            highlightedText += `<span style="background-color: ${highlightColor}; font-weight: bold;">${word}</span> `;
        } else {
            // Palabra igual, sin resaltar
            highlightedText += `${word} `;
        }
    });

    return highlightedText.trim();
}

// Función para obtener diferencias línea por línea entre dos textos
function getLineByLineDifferences(text1, text2) {
    const diffLines1 = text1.split('\n');
    const diffLines2 = text2.split('\n');

    let differences = '';

    diffLines1.forEach((line, index) => {
        if (line !== diffLines2[index]) {
            differences += `Línea:\n- ${line || '(vacío)'}\n+ ${diffLines2[index] || '(vacío)'}\n\n`;
        }
    });

    return differences || 'No se encontraron diferencias.';
}

// Sincronizar scroll entre ambos cuadros de texto
function syncScroll(event) {
    const otherDivs = document.querySelectorAll('.sync-scroll');
    otherDivs.forEach(div => {
        if (div !== event.target) {
            div.scrollTop = event.target.scrollTop;
            div.scrollLeft = event.target.scrollLeft;
        }
    });
}

// Función para seleccionar una carpeta y cargar archivos .docx (incluyendo subcarpetas)
document.getElementById('selectFolderBtn').addEventListener('click', async function () {
    try {
        const folderHandle = await window.showDirectoryPicker();
        docxFiles = []; // Reiniciar la lista de archivos

        // Obtener todos los archivos .docx de la carpeta y sus subcarpetas
        docxFiles = await getDocxFilesFromFolder(folderHandle);

        showNotification(`Archivos .docx cargados: ${docxFiles.length}`, "success");
        showNotification(`Escriba la palabra o texto a buscar en el cuadro de texto.`, "info");

        // Cerrar el modal después de seleccionar la carpeta
        const folderSelectModal = bootstrap.Modal.getInstance(document.getElementById('folderSelectModal'));
        folderSelectModal.hide();

    } catch (error) {
        console.error("Error al seleccionar la carpeta:", error);
        showNotification(`Error al seleccionar carpeta, debe recargar la página.`, "warning");
    }
});

// Sincronizar scroll en los cuadros de texto
document.querySelectorAll('.sync-scroll').forEach(div => {
    div.addEventListener('scroll', syncScroll);
});

// Abrir modal del comparador
document.getElementById('compareBtn').addEventListener('click', () => {
    populateFileSelectors(); // Llenar selectores al abrir el modal
});

// Comparar archivos seleccionados o cargados manualmente
document.getElementById('compareFilesBtn').addEventListener('click', compareFiles);

// Eventos para cargar archivos DOCX en cada lado
document.getElementById('loadLeftDocxBtn').addEventListener('click', () => loadDocx('left'));
document.getElementById('loadRightDocxBtn').addEventListener('click', () => loadDocx('right'));

// Cargar JSON dentro del comparador
document.getElementById('loadJSONCompareBtn').addEventListener('change', loadJSON);

// Generar Log
document.getElementById('generateLogBtn').addEventListener('click', generateLog);