import json
import re

# Load partial file content
with open("/home/user/workspace/nameswipe/generate_girls_and_more_boys.partial.c187d3.py", "r") as f:
    content = f.read()

# Extract all name/meaning pairs using regex
pattern = r'\{"name":\s*"([^"]+)",\s*"meaning":\s*"([^"]+)"\}'
all_matches = re.findall(pattern, content)
print(f"Total matches found: {len(all_matches)}")

# Find where girl_names starts (line 544 = approximately this content position)
girl_start_idx = content.find("girl_names = [")
boy_section = content[:girl_start_idx]
girl_section = content[girl_start_idx:]

boy_matches = re.findall(pattern, boy_section)
girl_matches = re.findall(pattern, girl_section)
print(f"Additional boy names in partial: {len(boy_matches)}")
print(f"Girl names in partial: {len(girl_matches)}")

# Convert to dicts
extra_boys = [{"name": m[0], "meaning": m[1]} for m in boy_matches]
partial_girls = [{"name": m[0], "meaning": m[1]} for m in girl_matches]

# Save for use
with open("/home/user/workspace/nameswipe/extra_boys_partial.json", "w") as f:
    json.dump(extra_boys, f, indent=2)
with open("/home/user/workspace/nameswipe/partial_girls.json", "w") as f:
    json.dump(partial_girls, f, indent=2)

print("Saved partial datasets")
