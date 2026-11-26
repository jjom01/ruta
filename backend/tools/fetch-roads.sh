#!/bin/bash
# Descarga la red vial de Bogotá (OpenStreetMap vía Overpass) en 6 teselas a .cache/roads-N.json
# Vías por las que puede ir un bus; sin parqueaderos ni accesos privados.
cd "$(dirname "$0")/.cache" || exit 1
Q='way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|busway|bus_guideway|service)$"]["service"!~"parking_aisle|driveway|drive-through|emergency_access"]["access"!~"private|no"]'
i=0
for lat in "4.45,4.55" "4.55,4.65" "4.65,4.75" "4.75,4.86"; do
  for lon in "-74.26,-74.12" "-74.12,-73.97"; do
    i=$((i+1)); S=${lat%,*}; N=${lat#*,}; W=${lon%,*}; E=${lon#*,}
    [ -s roads-$i.json ] && continue
    for try in 1 2 3 4 5 6; do
      curl -s -m 280 -A "Ruta/1.0" --data-urlencode "data=[out:json][timeout:250];($Q($S,$W,$N,$E););out geom;" https://overpass-api.de/api/interpreter -o roads-$i.tmp
      if python3 -c "import json,sys;json.load(open('roads-$i.tmp'))['elements']" 2>/dev/null; then mv roads-$i.tmp roads-$i.json; echo "tesela $i ok $(du -h roads-$i.json | cut -f1)"; break; fi
      echo "tesela $i reintento $try"; sleep $((20*try))
    done
  done
done
echo listo
