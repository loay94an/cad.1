using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Floorplan.Api.Database.Migrations
{
    /// <inheritdoc />
    public partial class HomeVersions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "HomeVersions",
                columns: table => new
                {
                    Id = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                    HomeId = table.Column<string>(type: "TEXT", nullable: false),
                    Name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    Document = table.Column<string>(type: "TEXT", nullable: false),
                    Auto = table.Column<bool>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    CreatedById = table.Column<string>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HomeVersions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_HomeVersions_Homes_HomeId",
                        column: x => x.HomeId,
                        principalTable: "Homes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_HomeVersions_Users_CreatedById",
                        column: x => x.CreatedById,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_HomeVersions_CreatedById",
                table: "HomeVersions",
                column: "CreatedById");

            migrationBuilder.CreateIndex(
                name: "IX_HomeVersions_HomeId_CreatedAt",
                table: "HomeVersions",
                columns: new[] { "HomeId", "CreatedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "HomeVersions");
        }
    }
}
