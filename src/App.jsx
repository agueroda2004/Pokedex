import { useState } from "react";
import { COLORES_TIPOS } from "./constants/Colors";
import { CATEGORIAS_MOVIMIENTOS } from "./constants/Category";
import { TRADUCCION_TIPOS } from "./constants/traduccionTipos";

const extraerStats = (statsArray) => {
  const stats = {};
  let total = 0;

  statsArray.forEach((s) => {
    // La API usa nombres con guiones, los cambiamos a camelCase para mayor comodidad
    if (s.stat.name === "special-attack") stats.spAtk = s.base_stat;
    else if (s.stat.name === "special-defense") stats.spDef = s.base_stat;
    else stats[s.stat.name] = s.base_stat; // hp, attack, defense, speed

    total += s.base_stat;
  });

  stats.total = total;
  return stats;
};

const calcularRelacionesDeTipos = (datosDeLosTipos) => {
  const multiplicadoresDefensa = {};

  // 1. Inicializamos todos los tipos en daño neutral (x1)
  const todosLosTipos = [
    "normal",
    "fighting",
    "flying",
    "poison",
    "ground",
    "rock",
    "bug",
    "ghost",
    "steel",
    "fire",
    "water",
    "grass",
    "electric",
    "psychic",
    "ice",
    "dragon",
    "dark",
    "fairy",
  ];
  todosLosTipos.forEach((tipo) => (multiplicadoresDefensa[tipo] = 1));

  // 2. Calculamos los multiplicadores
  datosDeLosTipos.forEach((tipoData) => {
    const relaciones = tipoData.damage_relations;
    relaciones.double_damage_from.forEach(
      (t) => (multiplicadoresDefensa[t.name] *= 2),
    );
    relaciones.half_damage_from.forEach(
      (t) => (multiplicadoresDefensa[t.name] *= 0.5),
    );
    relaciones.no_damage_from.forEach(
      (t) => (multiplicadoresDefensa[t.name] *= 0),
    );
  });

  // 3. Agrupamos por categoría guardando el multiplicador
  const debilidades = [];
  const resistencias = [];
  const inmunidades = [];

  for (const [tipo, valor] of Object.entries(multiplicadoresDefensa)) {
    if (valor > 1) {
      debilidades.push({ tipo, multiplicador: valor });
    } else if (valor < 1 && valor > 0) {
      resistencias.push({ tipo, multiplicador: valor });
    } else if (valor === 0) {
      inmunidades.push({ tipo, multiplicador: valor });
    }
  }

  // Ordenamos de mayor a menor daño (opcional, pero se ve mejor)
  debilidades.sort((a, b) => b.multiplicador - a.multiplicador);
  resistencias.sort((a, b) => a.multiplicador - b.multiplicador);

  return { debilidades, resistencias, inmunidades };
};

const obtenerMetodoEvolucion = (detalles) => {
  // El primer Pokémon de la cadena no tiene detalles de evolución
  if (!detalles || detalles.length === 0) return "Forma Base";

  // Tomamos el primer método válido
  const detalle = detalles[0];
  const trigger = detalle.trigger?.name;

  // 1. Evolución por Nivel
  if (trigger === "level-up") {
    if (detalle.min_level) return `Nivel ${detalle.min_level}`;
    if (detalle.min_happiness) return "Por Felicidad";
    if (detalle.location)
      return `En: ${detalle.location.name.replace("-", " ")}`;
    if (detalle.known_move)
      return `Sabiendo: ${detalle.known_move.name.replace("-", " ")}`;
    if (detalle.time_of_day) return `Subir nivel de ${detalle.time_of_day}`;
    return "Subir de nivel";
  }

  // 2. Evolución por Objeto (Piedras, etc.)
  if (trigger === "use-item" && detalle.item) {
    const nombreObjeto = detalle.item.name.replace("-", " ");
    return `Objeto: ${nombreObjeto}`;
  }

  // 3. Evolución por Intercambio
  if (trigger === "trade") {
    if (detalle.held_item) {
      const nombreObjeto = detalle.held_item.name.replace("-", " ");
      return `Intercambio con ${nombreObjeto}`;
    }
    return "Por Intercambio";
  }

  // 4. Casos por defecto u otros métodos raros
  return "Especial";
};

const extraerEvoluciones = (nodoEvolucion) => {
  const evoluciones = [];

  const recorrerArbol = (nodo) => {
    // Usamos nuestra nueva función para obtener el texto exacto
    const metodoEvolucion = obtenerMetodoEvolucion(nodo.evolution_details);

    evoluciones.push({
      nombre: nodo.species.name,
      metodo: metodoEvolucion, // Guardamos el método procesado
    });

    nodo.evolves_to.forEach((siguienteEvolucion) => {
      recorrerArbol(siguienteEvolucion);
    });
  };

  recorrerArbol(nodoEvolucion);
  return evoluciones;
};

function App() {
  const [terminoBusqueda, setTerminoBusqueda] = useState("");
  const [pokemon, setPokemon] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  // Nuevo estado para controlar la pestaña activa:
  const [pestañaMovimientos, setPestañaMovimientos] = useState("nivel");

  const buscarPokemon = async (e) => {
    e.preventDefault(); // Evita que la página se recargue al enviar el formulario

    if (!terminoBusqueda) return;

    setCargando(true);
    setError(null);
    setPokemon(null);

    try {
      const query = terminoBusqueda.trim().toLowerCase();

      // 1. Primera petición: Datos básicos
      const resBasica = await fetch(
        `https://pokeapi.co/api/v2/pokemon/${query}`,
      );
      if (!resBasica.ok) throw new Error("Pokémon no encontrado.");
      const datosBasicos = await resBasica.json();

      // 2. Segunda petición: Especie para la descripción
      const resEspecie = await fetch(
        `https://pokeapi.co/api/v2/pokemon-species/${datosBasicos.id}`,
      );
      const datosEspecie = await resEspecie.json();

      // 3. Extraer la descripción en español (y limpiar caracteres raros de la API)
      const entradaTexto = datosEspecie.flavor_text_entries.find(
        (entrada) => entrada.language.name === "es",
      );
      const descripcionLimpia = entradaTexto
        ? entradaTexto.flavor_text.replace(/\f/g, " ").replace(/\n/g, " ")
        : "Descripción no disponible.";

      // 3. Petición a la URL de la cadena de evolución
      const resEvolucion = await fetch(datosEspecie.evolution_chain.url);
      const datosEvolucion = await resEvolucion.json();

      // 4. Aplanamos el árbol para tener una lista simple de nombres y niveles
      const listaEvoluciones = extraerEvoluciones(datosEvolucion.chain);

      // 5. Peticiones en paralelo para obtener los sprites de CADA evolución
      // Usamos Promise.all para que todas las peticiones se hagan al mismo tiempo y sea más rápido
      const evolucionesCompletas = await Promise.all(
        listaEvoluciones.map(async (evo) => {
          const resSprite = await fetch(
            `https://pokeapi.co/api/v2/pokemon/${evo.nombre}`,
          );
          const datosSprite = await resSprite.json();

          return {
            nombre: evo.nombre,
            metodo: evo.metodo,
            sprite: datosSprite.sprites.front_default,
          };
        }),
      );

      // Extraemos las URLs de los tipos que tiene el Pokémon (pueden ser 1 o 2)
      const promesasTipos = datosBasicos.types.map((tipoInfo) =>
        fetch(tipoInfo.type.url).then((res) => res.json()),
      );

      // Esperamos a que se descargue la información de todos sus tipos
      const detallesTipos = await Promise.all(promesasTipos);

      // Pasamos los datos a nuestro algoritmo
      const relacionesCombate = calcularRelacionesDeTipos(detallesTipos);

      // 7. Extraer todos los movimientos relevantes (Nivel y Máquina/MT)
      const todosLosMovimientos = datosBasicos.moves
        .map((m) => {
          const detalleNivel = m.version_group_details.find(
            (vg) => vg.move_learn_method.name === "level-up",
          );
          const detalleMT = m.version_group_details.find(
            (vg) => vg.move_learn_method.name === "machine",
          );

          if (!detalleNivel && !detalleMT) return null;

          return {
            url: m.move.url,
            aprendePorNivel: !!detalleNivel,
            nivel: detalleNivel ? detalleNivel.level_learned_at : null,
            aprendePorMT: !!detalleMT,
          };
        })
        .filter((m) => m !== null);

      // 8. Peticiones en paralelo para obtener los detalles técnicos de todos
      const promesasMovimientos = todosLosMovimientos.map((mov) =>
        fetch(mov.url).then((res) => res.json()),
      );
      const detallesMovimientos = await Promise.all(promesasMovimientos);

      // Formateamos la información combinada
      const movimientosCompletos = detallesMovimientos.map((detalle, index) => {
        const infoBase = todosLosMovimientos[index];

        // 1. Buscamos el nombre en español dentro del arreglo de idiomas
        const traduccionEspañol = detalle.names.find(
          (n) => n.language.name === "es",
        );

        return {
          ...infoBase,
          // 2. Usamos la traducción si existe, si no, dejamos el original como respaldo
          nombre: traduccionEspañol
            ? traduccionEspañol.name
            : detalle.name.replace("-", " "),

          tipo: detalle.type.name,
          categoria: detalle.damage_class.name,
          poder: detalle.power || "—",
          precision: detalle.accuracy ? `${detalle.accuracy}%` : "—",
          pp: detalle.pp || "—",
        };
      });

      // Separamos en dos listas para nuestras pestañas
      const listaNivel = movimientosCompletos
        .filter((m) => m.aprendePorNivel)
        .sort((a, b) => a.nivel - b.nivel);

      const listaMT = movimientosCompletos
        .filter((m) => m.aprendePorMT)
        .sort((a, b) => a.nombre.localeCompare(b.nombre)); // Orden alfabético para las MTs

      // 9. Guardamos todo en el estado consolidado
      setPokemon({
        id: datosBasicos.id,
        nombre: datosBasicos.name,
        imagen: datosBasicos.sprites.front_default,
        tipos: datosBasicos.types,
        peso: datosBasicos.weight / 10,
        altura: datosBasicos.height / 10,
        descripcion: descripcionLimpia,
        evoluciones: evolucionesCompletas,
        relaciones: relacionesCombate,
        stats: extraerStats(datosBasicos.stats),
        movimientosNivel: listaNivel, // Guardamos lista 1
        movimientosMT: listaMT, // Guardamos lista 2
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="bg-background-light font-display text-slate-900 min-h-screen">
      <div className="layout-container flex h-full grow flex-col">
        <main className="max-w-300 mx-auto w-full px-6 md:px-10 py-8 min-h-screen">
          <section className="mb-10">
            <div className="max-w-3xl mx-auto">
              <div className="flex flex-col md:flex-row gap-3 p-2 bg-white rounded-2xl shadow-lg border border-[#e3340d]/20">
                <div className="relative flex-1">
                  <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-[#e3340d]/40 text-2xl">
                    search
                  </span>
                  <input
                    className="w-full pl-14 pr-4 py-4 bg-transparent border-none focus:ring-0 text-lg text-slate-900 placeholder:text-slate-400 font-medium outline-none"
                    placeholder="Busca un Pokémon por nombre o número..."
                    type="text"
                    value={terminoBusqueda}
                    onChange={(e) => {
                      setTerminoBusqueda(e.target.value);
                      setError(null);
                    }}
                  />
                </div>
                <button
                  className="bg-[#e3340d] hover:bg-[#e3340d]/90 text-white px-10 py-4 rounded-xl font-bold text-lg transition-all shadow-md active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
                  onClick={buscarPokemon}
                >
                  {cargando ? (
                    <span className="material-symbols-outlined animate-spin">
                      progress_activity
                    </span>
                  ) : (
                    <>
                      <span className="material-symbols-outlined">search</span>
                      Buscar
                    </>
                  )}
                </button>
              </div>
            </div>
            <div className="h-px w-full bg-gradient-to-r from-transparent via-[#e3340d]/20 to-transparent mt-10"></div>
          </section>
          {error && (
            <div className="bg-white  rounded-b-xl overflow-hidden">
              <div className="flex flex-col px-4 md:px-10 py-12 items-center text-center">
                <div className="relative mb-8"></div>
                <div className="max-w-[540px] flex flex-col items-center gap-4">
                  <h1 class="text-slate-900  text-3xl font-black leading-tight tracking-tight">
                    ¡Pokémon no encontrado!
                  </h1>
                  <p class="text-slate-600  text-lg font-normal leading-relaxed">
                    Vaya, parece que <strong>{terminoBusqueda}</strong>{" "}
                    pertenece a otro mundo digital. No hemos podido localizar a
                    ese Pokémon en nuestra base de datos nacional.
                  </p>
                  <div className="w-full mt-4 p-6 bg-slate-50 rounded-xl border border-slate-100 text-left">
                    <h4 className="text-slate-900  font-bold mb-3 flex items-center gap-2">
                      <span
                        className="material-symbols-outlined text-[#e3340d] text-sm"
                        data-icon="lightbulb"
                      >
                        lightbulb
                      </span>
                      Sugerencias de búsqueda:
                    </h4>
                    <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
                      <li className="flex items-start gap-2">
                        <span className="text-[#e3340d] mt-1">•</span>
                        <span>
                          Comprueba que el nombre esté escrito correctamente
                          (ej. "Pikachu" en lugar de "Pikaxu").
                        </span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-[#e3340d] mt-1">•</span>
                        <span>
                          Intenta buscar por el número de la Pokédex Nacional
                          (ej. "25").
                        </span>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}
          {pokemon && !cargando && (
            <>
              <section className="bg-white rounded-xl p-6 shadow-sm border border-[#e3340d]/10 mb-8">
                <div className="flex flex-col md:flex-row items-center gap-8">
                  <div className="relative group">
                    <img
                      src={pokemon.imagen}
                      alt={pokemon.nombre}
                      className="size-50"
                    />
                  </div>
                  <div className="flex-1 text-center md:text-left">
                    <div className="flex flex-col md:flex-row md:items-baseline gap-2 mb-2">
                      <span className="text-[#e3340d] font-bold text-xl">
                        #{pokemon.id}
                      </span>
                      <h1 className="text-4xl font-bold text-slate-900">
                        {pokemon.nombre.charAt(0).toUpperCase() +
                          pokemon.nombre.slice(1)}
                      </h1>
                    </div>
                    <div className="flex flex-wrap justify-center md:justify-start gap-2 mb-4">
                      {pokemon.tipos.map((tipo, index) => {
                        const nombreTipo = tipo.type.name;
                        return (
                          <span
                            style={{
                              backgroundColor:
                                COLORES_TIPOS[nombreTipo] || "#777",
                              color: "white",
                              padding: "5px 15px",
                              borderRadius: "20px",
                              textTransform: "capitalize",
                              fontWeight: "bold",
                            }}
                            key={index}
                          >
                            {TRADUCCION_TIPOS[nombreTipo] || nombreTipo}
                          </span>
                        );
                      })}
                    </div>
                    <p className="text-slate-500 max-w-xl italic">
                      {pokemon.descripcion}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-4 w-full md:w-auto">
                    <div className="bg-[#e3340d]/5 rounded-lg p-3 text-center">
                      <span className="block text-xs text-[#e3340d]/60 font-bold uppercase mb-1">
                        Altura
                      </span>
                      <span className="text-lg font-bold">
                        {pokemon.altura} m
                      </span>
                    </div>
                    <div className="bg-[#e3340d]/5 rounded-lg p-3 text-center">
                      <span className="block text-xs text-[#e3340d]/60 font-bold uppercase mb-1">
                        Peso
                      </span>
                      <span className="text-lg font-bold">
                        {pokemon.peso} kg
                      </span>
                    </div>
                  </div>
                </div>
              </section>

              <section className="mb-12">
                <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#e3340d]">
                    account_tree
                  </span>
                  Cadena de Evolución
                </h2>
                <div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-around",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: "10px",
                    }}
                    className="bg-white rounded-xl p-6 shadow-sm border border-[#e3340d]/10 mb-8"
                  >
                    {/* Dentro de tu mapeo de evoluciones */}
                    {pokemon.evoluciones.map((evo, index) => (
                      <div
                        key={evo.nombre}
                        style={{ textAlign: "center", width: "100px" }}
                      >
                        {/* Ahora mostramos el método de evolución en lugar de solo el nivel */}
                        <div
                          style={{
                            fontSize: "0.75rem",
                            color: "#888",
                            marginBottom: "5px",
                            minHeight: "30px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            textTransform: "capitalize",
                          }}
                        >
                          {evo.metodo}
                        </div>

                        <img
                          src={evo.sprite}
                          alt={evo.nombre}
                          style={{
                            width: "80px",
                            height: "80px",
                            backgroundColor: "#f0f0f0",
                            borderRadius: "50%",
                          }}
                        />
                        <p
                          style={{
                            margin: "5px 0 0 0",
                            textTransform: "capitalize",
                            fontSize: "0.9rem",
                            fontWeight: "bold",
                          }}
                        >
                          {evo.nombre}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="mb-12">
                <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#e3340d]">
                    shield_with_heart
                  </span>
                  Debilidades y Resistencias
                </h2>

                <div className="bg-white rounded-xl p-8 shadow-sm border border-[#e3340d]/10">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    {/* SECCIÓN DE DEBILIDADES */}
                    <div>
                      <h3 className="text-sm font-bold uppercase tracking-wider text-red-600 mb-4">
                        Debilidades (2x / 4x)
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {pokemon.relaciones.debilidades.length > 0 ? (
                          pokemon.relaciones.debilidades.map((item) => (
                            <div
                              key={item.tipo}
                              className="flex flex-col items-center gap-1"
                            >
                              <span
                                className="px-3 py-1 text-white rounded text-[10px] font-bold uppercase"
                                style={{
                                  backgroundColor:
                                    COLORES_TIPOS[item.tipo] || "#777",
                                }}
                              >
                                {TRADUCCION_TIPOS[item.tipo] || item.tipo}
                              </span>
                              <span className="text-[10px] font-bold text-slate-400">
                                {item.multiplicador}x
                              </span>
                            </div>
                          ))
                        ) : (
                          <span className="text-sm text-slate-400">None</span>
                        )}
                      </div>
                    </div>

                    {/* SECCIÓN DE RESISTENCIAS */}
                    <div>
                      <h3 className="text-sm font-bold uppercase tracking-wider text-green-600 mb-4">
                        Recistencias (0.5x / 0.25x)
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {pokemon.relaciones.resistencias.length > 0 ? (
                          pokemon.relaciones.resistencias.map((item) => (
                            <div
                              key={item.tipo}
                              className="flex flex-col items-center gap-1"
                            >
                              <span
                                className="px-3 py-1 text-white rounded text-[10px] font-bold uppercase"
                                style={{
                                  backgroundColor:
                                    COLORES_TIPOS[item.tipo] || "#777",
                                }}
                              >
                                {TRADUCCION_TIPOS[item.tipo] || item.tipo}
                              </span>
                              <span className="text-[10px] font-bold text-slate-400">
                                {item.multiplicador}x
                              </span>
                            </div>
                          ))
                        ) : (
                          <span className="text-sm text-slate-400">None</span>
                        )}
                      </div>
                    </div>

                    {/* SECCIÓN DE INMUNIDADES */}
                    <div>
                      <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-4">
                        Inmunidad (0x)
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {pokemon.relaciones.inmunidades.length > 0 ? (
                          pokemon.relaciones.inmunidades.map((item) => (
                            <div
                              key={item.tipo}
                              className="flex flex-col items-center gap-1"
                            >
                              <span
                                className="px-3 py-1 text-white rounded text-[10px] font-bold uppercase"
                                style={{
                                  backgroundColor:
                                    COLORES_TIPOS[item.tipo] || "#777",
                                }}
                              >
                                {TRADUCCION_TIPOS[item.tipo] || item.tipo}
                              </span>
                              <span className="text-[10px] font-bold text-slate-400">
                                0x
                              </span>
                            </div>
                          ))
                        ) : (
                          <span className="text-sm text-slate-400">None</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </section>
              <section className="mb-12">
                <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#e3340d]">
                    bar_chart
                  </span>
                  Estadísticas Base
                </h2>
                <div className="bg-white rounded-xl p-8 shadow-sm border border-[#e3340d]/10">
                  <div className="space-y-4">
                    {/* HP */}
                    <div className="flex items-center gap-4">
                      <span className="w-24 text-sm font-bold text-slate-500 uppercase">
                        HP
                      </span>
                      <span className="w-8 text-sm font-bold text-slate-900">
                        {pokemon.stats.hp}
                      </span>
                      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-green-500 rounded-full"
                          style={{
                            width: `${(pokemon.stats.hp / 255) * 100}%`,
                          }}
                        ></div>
                      </div>
                    </div>

                    {/* ATTACK */}
                    <div className="flex items-center gap-4">
                      <span className="w-24 text-sm font-bold text-slate-500 uppercase">
                        Ataque
                      </span>
                      <span className="w-8 text-sm font-bold text-slate-900">
                        {pokemon.stats.attack}
                      </span>
                      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-red-500 rounded-full"
                          style={{
                            width: `${(pokemon.stats.attack / 255) * 100}%`,
                          }}
                        ></div>
                      </div>
                    </div>

                    {/* DEFENSE */}
                    <div className="flex items-center gap-4">
                      <span className="w-24 text-sm font-bold text-slate-500 uppercase">
                        Defensa
                      </span>
                      <span className="w-8 text-sm font-bold text-slate-900">
                        {pokemon.stats.defense}
                      </span>
                      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full"
                          style={{
                            width: `${(pokemon.stats.defense / 255) * 100}%`,
                          }}
                        ></div>
                      </div>
                    </div>

                    {/* SP. ATK */}
                    <div className="flex items-center gap-4">
                      <span className="w-24 text-sm font-bold text-slate-500 uppercase">
                        Sp. Atk
                      </span>
                      <span className="w-8 text-sm font-bold text-slate-900">
                        {pokemon.stats.spAtk}
                      </span>
                      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-purple-500 rounded-full"
                          style={{
                            width: `${(pokemon.stats.spAtk / 255) * 100}%`,
                          }}
                        ></div>
                      </div>
                    </div>

                    {/* SP. DEF */}
                    <div className="flex items-center gap-4">
                      <span className="w-24 text-sm font-bold text-slate-500 uppercase">
                        Sp. Def
                      </span>
                      <span className="w-8 text-sm font-bold text-slate-900">
                        {pokemon.stats.spDef}
                      </span>
                      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-teal-500 rounded-full"
                          style={{
                            width: `${(pokemon.stats.spDef / 255) * 100}%`,
                          }}
                        ></div>
                      </div>
                    </div>

                    {/* SPEED */}
                    <div className="flex items-center gap-4">
                      <span className="w-24 text-sm font-bold text-slate-500 uppercase">
                        Velocidad
                      </span>
                      <span className="w-8 text-sm font-bold text-slate-900">
                        {pokemon.stats.speed}
                      </span>
                      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#F08030] rounded-full"
                          style={{
                            width: `${(pokemon.stats.speed / 255) * 100}%`,
                          }}
                        ></div>
                      </div>
                    </div>

                    {/* TOTAL */}
                    <div className="pt-4 border-t border-[#e3340d]/5 mt-4">
                      <div className="flex items-center gap-4">
                        <span className="w-24 text-sm font-bold text-slate-900 uppercase">
                          Total
                        </span>
                        <span className="text-lg font-bold text-[#e3340d]">
                          {pokemon.stats.total}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
              <section>
                <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
                  <h2 className="text-2xl font-bold flex items-center gap-2">
                    <span className="material-symbols-outlined text-[#e3340d]">
                      bolt
                    </span>
                    {pestañaMovimientos === "nivel"
                      ? "Movimientos por nivel"
                      : "TM / HM movimientos"}
                  </h2>

                  {/* Botones Interactivos */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPestañaMovimientos("nivel")}
                      className={`px-4 py-2 text-sm font-bold rounded-lg transition-colors cursor-pointer ${pestañaMovimientos === "nivel" ? "bg-[#e3340d] text-white shadow-sm" : "bg-white text-slate-600 border border-[#e3340d]/10 hover:bg-[#e3340d]/5"}`}
                    >
                      Nivel
                    </button>
                    <button
                      onClick={() => setPestañaMovimientos("mt")}
                      className={`px-4 py-2 text-sm font-bold rounded-lg transition-colors cursor-pointer ${pestañaMovimientos === "mt" ? "bg-[#e3340d] text-white shadow-sm" : "bg-white text-slate-600 border border-[#e3340d]/10 hover:bg-[#e3340d]/5"}`}
                    >
                      TM / HM
                    </button>
                  </div>
                </div>
                <div className="bg-white rounded-xl overflow-hidden shadow-sm border border-[#e3340d]/10">
                  <div className="overflow-x-auto h-100">
                    <table className="w-full text-left border-collapse">
                      <thead className="sticky top-0 z-20 bg-white">
                        <tr className="text-[#e3340d] text-xs font-bold uppercase tracking-wider border-b border-[#e3340d]/10">
                          <th className="px-6 py-4 bg-[#e3340d]/5">Lvl</th>
                          <th className="px-6 py-4 bg-[#e3340d]/5">Nombre</th>
                          <th className="px-6 py-4 bg-[#e3340d]/5">Tipo</th>
                          <th className="px-6 py-4 bg-[#e3340d]/5">
                            Categoría
                          </th>
                          <th className="px-6 py-4 bg-[#e3340d]/5">Poder</th>
                          <th className="px-6 py-4 bg-[#e3340d]/5">Acc</th>
                          <th className="px-6 py-4 bg-[#e3340d]/5">PP</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#e3340d]/5">
                        {(pestañaMovimientos === "nivel"
                          ? pokemon.movimientosNivel
                          : pokemon.movimientosMT
                        ).map((mov, index) => (
                          <tr
                            key={`${mov.nombre}-${index}`}
                            className="hover:bg-[#e3340d]/5 transition-colors group"
                          >
                            {/* Nivel */}
                            <td className="px-6 py-4 font-bold text-[#e3340d]">
                              {mov.nivel === 0 ? "Evo" : mov.nivel}
                            </td>

                            {/* Nombre */}
                            <td className="px-6 py-4 font-semibold capitalize">
                              {mov.nombre}
                            </td>

                            {/* Tipo */}
                            <td className="px-6 py-4">
                              <span
                                className="px-3 py-1 text-white rounded text-[10px] font-bold uppercase"
                                style={{
                                  backgroundColor:
                                    COLORES_TIPOS[mov.tipo] || "#777",
                                }}
                              >
                                {mov.tipo}
                              </span>
                            </td>

                            {/* Categoría (Físico, Especial, Estado) */}
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-1">
                                <span
                                  className={`material-symbols-outlined text-sm ${CATEGORIAS_MOVIMIENTOS[mov.categoria]?.colorText}`}
                                >
                                  {CATEGORIAS_MOVIMIENTOS[mov.categoria]?.icono}
                                </span>
                                <span className="text-xs font-medium capitalize">
                                  {mov.categoria}
                                </span>
                              </div>
                            </td>

                            {/* Poder */}
                            <td className="px-6 py-4 font-medium">
                              {mov.poder}
                            </td>

                            {/* Precisión */}
                            <td className="px-6 py-4 font-medium">
                              {mov.precision}
                            </td>

                            {/* PP */}
                            <td className="px-6 py-4 font-medium">{mov.pp}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            </>
          )}
        </main>
        <footer className="mt-auto border-t border-[#e3340d]/10 py-8 bg-white text-center">
          <p className="text-[#e3340d]/60 text-sm">
            © 2024 PokéIndex. All Pokémon data belongs to Nintendo/Creatures
            Inc./GAME FREAK inc.
          </p>
        </footer>
      </div>
    </div>
  );
}

export default App;
