#!/bin/bash
# Batch export students in ranges

echo "Creating student export batches..."

# Create batch files for different ID ranges
for start in 0 1000 2000 3000 4000 5000 6000 7000 8000 9000 10000 11000 12000 13000; do
  end=$((start + 999))
  filename="db-export/students-batch-${start}-${end}.sql"
  echo "-- Students batch: IDs ${start} to ${end}" > "$filename"
  echo "-- Copy this entire file content and paste into production database console" >> "$filename"
  echo "" >> "$filename"
done

echo "Batch files created. Now exporting data..."
