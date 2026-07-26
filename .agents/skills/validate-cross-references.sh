#!/usr/bin/env bash
# Validate that all relatedSkills cross-references point to existing skills

set -uo pipefail  # Removed -e to continue on errors

SKILLS_DIR="$(cd "$(dirname "$0")" && pwd)"
EXIT_CODE=0

echo "🔍 Validating skills cross-references..."
echo ""

# Get list of all skills (directories with SKILL.md)
ALL_SKILLS=()
while IFS= read -r -d '' skill_file; do
    skill_dir=$(dirname "$skill_file")
    skill_name=$(basename "$skill_dir")
    ALL_SKILLS+=("$skill_name")
done < <(find "$SKILLS_DIR" -name "SKILL.md" -type f -print0)

echo "Found ${#ALL_SKILLS[@]} skills: ${ALL_SKILLS[*]}"
echo ""

# Helper function to extract YAML frontmatter field
extract_yaml_field() {
    local file="$1"
    local field="$2"
    
    # Extract content between --- markers, then find the field
    # Use awk to get only lines between first and second ---
    awk '/^---$/{if (++n==2) exit} n==1' "$file" | \
        grep "^${field}:" | \
        head -1 | \
        sed "s/^${field}:[[:space:]]*//" | \
        tr -d '\r'
}

# For each skill, extract and validate relatedSkills
for skill_file in "$SKILLS_DIR"/*/SKILL.md; do
    if [ ! -f "$skill_file" ]; then
        continue
    fi
    
    skill_dir=$(dirname "$skill_file")
    skill_name=$(basename "$skill_dir")
    
    # Extract name from frontmatter
    frontmatter_name=$(extract_yaml_field "$skill_file" "name")
    
    # Check if name matches directory
    if [ -z "$frontmatter_name" ]; then
        echo "⚠️  $skill_name: Could not extract name from frontmatter"
    elif [ "$frontmatter_name" != "$skill_name" ]; then
        echo "❌ $skill_name: Frontmatter name '$frontmatter_name' doesn't match directory name"
        EXIT_CODE=1
    else
        echo "✅ $skill_name: Name matches directory"
    fi
    
    # Extract relatedSkills (handle array format: [skill1, skill2])
    related_line=$(extract_yaml_field "$skill_file" "relatedSkills")
    
    if [ -z "$related_line" ]; then
        echo "   ℹ️  No relatedSkills defined"
        continue
    fi
    
    # Parse the array: remove [], split by comma, trim whitespace
    related_skills=$(echo "$related_line" | tr -d '[]' | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | grep -v '^$')
    
    # Validate each related skill exists
    while IFS= read -r related; do
        if [ -z "$related" ]; then
            continue
        fi
        
        if [ -d "$SKILLS_DIR/$related" ] && [ -f "$SKILLS_DIR/$related/SKILL.md" ]; then
            echo "   ✅ References: $related"
        else
            echo "   ❌ References: $related (NOT FOUND)"
            EXIT_CODE=1
        fi
    done <<< "$related_skills"
    
    echo ""
done

# Check for asymmetric cross-references
echo "🔗 Checking for asymmetric cross-references..."
echo ""

for skill_file in "$SKILLS_DIR"/*/SKILL.md; do
    if [ ! -f "$skill_file" ]; then
        continue
    fi
    
    skill_dir=$(dirname "$skill_file")
    skill_name=$(basename "$skill_dir")
    
    # Extract relatedSkills
    related_line=$(extract_yaml_field "$skill_file" "relatedSkills" || true)
    
    if [ -z "$related_line" ]; then
        continue
    fi
    
    related_skills=$(echo "$related_line" | tr -d '[]' | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | grep -v '^$')
    
    # For each related skill, check if it references back
    while IFS= read -r related; do
        if [ -z "$related" ] || [ ! -f "$SKILLS_DIR/$related/SKILL.md" ]; then
            continue
        fi
        
        # Check if the related skill references this skill back
        reverse_line=$(extract_yaml_field "$SKILLS_DIR/$related/SKILL.md" "relatedSkills" || true)
        
        if [ -z "$reverse_line" ]; then
            echo "⚠️  $skill_name → $related, but $related has no relatedSkills"
            continue
        fi
        
        reverse_refs=$(echo "$reverse_line" | tr -d '[]' | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        
        if echo "$reverse_refs" | grep -qw "$skill_name"; then
            : # Reciprocal reference exists, all good
        else
            echo "⚠️  $skill_name → $related, but $related ↛ $skill_name"
        fi
    done <<< "$related_skills"
done

echo ""
if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ All cross-references are valid!"
else
    echo "❌ Some cross-references are invalid"
fi

exit $EXIT_CODE
